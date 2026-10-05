// HTML into the open document, in one transaction: measure it in the browser, convert it to
// nodes, reconcile them with the layers it replaces, apply. Inserting puts the HTML under a parent
// (top-level designs go beside everything on the page); replacing rewrites one layer and what is
// below it, keeping the layers whose `data-id` the HTML still carries.

import {
	planCreateInstance,
	planInsertAll,
	planRemove,
	planSetProps,
	type ApplyMeta,
	type Change,
	type Node,
	type NodeId,
	type Rect,
	type RGBA
} from '../../document';
import type { DocumentService } from '../../services/document';
import type { VariablesService } from '../../services/variables';
import { placeBeside } from '../generate';
import { convertSnapshot, type InstanceRequest } from './convert';
import { FALLBACK_FAMILY } from '../../fonts/bundled';
import type { HtmlMeasurer } from '../../services/htmlLayout';
import { planReconcile, type ReconcilePlan, type ReconcileTarget } from './reconcile';

export interface HtmlServices {
	document: DocumentService;
	variables?: VariablesService;
	layout: HtmlMeasurer;
}

export type HtmlTarget =
	{ kind: 'insert'; parentId?: NodeId; position?: number } | { kind: 'replace'; id: NodeId };

export interface ApplyHtmlResult {
	rootIds: NodeId[];
	created: NodeId[];
	changed: NodeId[];
	removed: NodeId[];
	changeCount: number;
	warnings: string[];
}

const PAGE_VIEWPORT_WIDTH = 1440;
const MAX_LAYERS = 1500;

/** `--name` for a variable: its name in kebab case (`Colors/Surface` -> `--colors-surface`). */
export function cssVariableName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `--${slug === '' ? 'variable' : slug}`;
}

function cssValueOf(value: unknown): string | null {
	if (typeof value === 'number') return `${value}px`;
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value !== 'object' || value === null || !('r' in value)) return null;
	const color = value as RGBA;
	const channel = (amount: number): number => Math.round(amount * 255);
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${color.a})`;
}

export interface VariableCss {
	/** Variable id to `--name`. */
	names: Record<string, string>;
	/** `--name` to variable id. */
	ids: Record<string, string>;
	/** `--name` to its value in the default modes, for the layout. */
	values: Record<string, string>;
}

export function variableCss(variables: VariablesService | undefined): VariableCss {
	const css: VariableCss = { names: {}, ids: {}, values: {} };
	if (variables === undefined) return css;
	for (const variable of variables.variables()) {
		let name = cssVariableName(variable.name);
		if (css.ids[name] !== undefined) name = `${name}-${variable.id.replace(/[^a-zA-Z0-9]/g, '')}`;
		css.names[variable.id] = name;
		css.ids[name] = variable.id;
		const value = cssValueOf(variables.resolveVariable(variable.id));
		if (value !== null) css.values[name] = value;
	}
	return css;
}

function besidePageContent(document: DocumentService): { x: number; y: number } {
	const bounds: Rect[] = document
		.children(document.currentPageId)
		.map((id) => document.absoluteBounds(id));
	return placeBeside(bounds);
}

function subtreeOf(document: DocumentService, id: NodeId): Node[] {
	return [document.require(id), ...document.reader.descendants(id)];
}

function textFamilies(nodes: readonly Node[]): Set<string> {
	const families = new Set<string>();
	for (const node of nodes) {
		if (node.type !== 'TEXT') continue;
		families.add(node.defaultStyle.fontName.family);
		for (const paragraph of node.paragraphs) {
			for (const run of paragraph.runs) {
				if (run.style.fontName !== undefined) families.add(run.style.fontName.family);
			}
		}
	}
	return families;
}

interface Placement {
	target: ReconcileTarget;
	parentId: NodeId;
	viewportWidth: number;
	/** Where the first root goes; `null` keeps the offset the HTML gave it. */
	origin: { x: number; y: number } | null;
}

function placementOf(document: DocumentService, target: HtmlTarget): Placement {
	if (target.kind === 'replace') {
		const node = document.require(target.id);
		if (node.type === 'PAGE' || node.parentId === null) {
			throw new Error('a page cannot be replaced; write into it instead');
		}
		const parent = document.require(node.parentId);
		let viewportWidth = PAGE_VIEWPORT_WIDTH;
		if (parent.type !== 'PAGE' && 'width' in parent) viewportWidth = parent.width;
		return {
			target: { kind: 'replace', id: target.id },
			parentId: node.parentId,
			viewportWidth,
			origin: { x: node.transform[0][2], y: node.transform[1][2] }
		};
	}
	const parentId = target.parentId ?? document.currentPageId;
	const parent = document.require(parentId);
	const siblings = document.reader.childNodes(parentId);
	const slot = Math.max(0, Math.min(target.position ?? siblings.length, siblings.length));
	const lower = slot > 0 ? siblings[slot - 1].index : null;
	const upper = slot < siblings.length ? siblings[slot].index : null;
	if (parent.type === 'PAGE') {
		return {
			target: { kind: 'insert', parentId, lower, upper },
			parentId,
			viewportWidth: PAGE_VIEWPORT_WIDTH,
			origin: besidePageContent(document)
		};
	}
	let viewportWidth = PAGE_VIEWPORT_WIDTH;
	if ('width' in parent) viewportWidth = parent.width;
	return {
		target: { kind: 'insert', parentId, lower, upper },
		parentId,
		viewportWidth,
		origin: null
	};
}

/** The main component an element's `data-component` names: by id, name, or component set name. */
function findComponent(document: DocumentService, name: string): NodeId | undefined {
	const wanted = name.trim().toLowerCase();
	const matches = document.query(
		(node) =>
			(node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
			(node.id === name || node.name.toLowerCase() === wanted)
	);
	const component = matches.find((node) => node.type === 'COMPONENT');
	if (component !== undefined) return component.id;
	const set = matches.find((node) => node.type === 'COMPONENT_SET');
	if (set === undefined) return undefined;
	return document.reader.childNodes(set.id).find((child) => child.type === 'COMPONENT')?.id;
}

interface InstanceSwap {
	placeholder: Node;
	mainId: NodeId;
	name: string | undefined;
}

/** New placeholder layers for `data-component` elements become instances; their subtrees go. */
function instanceSwaps(
	document: DocumentService,
	plan: ReconcilePlan,
	requests: readonly InstanceRequest[],
	warnings: string[]
): InstanceSwap[] {
	const added = new Map(plan.adds.map((node) => [node.id, node]));
	const swaps: InstanceSwap[] = [];
	const dropped = new Set<NodeId>();
	for (const request of requests) {
		const placeholder = added.get(request.nodeId);
		if (placeholder === undefined) continue;
		const mainId = findComponent(document, request.component);
		if (mainId === undefined) {
			warnings.push(`no component "${request.component}" in this file; drew it as plain layers`);
			continue;
		}
		swaps.push({ placeholder, mainId, name: request.name });
		dropped.add(placeholder.id);
	}
	plan.adds = plan.adds.filter((node) => {
		if (node.parentId !== null && dropped.has(node.parentId)) dropped.add(node.id);
		return !dropped.has(node.id);
	});
	return swaps;
}

/** Inserts the instance where the placeholder was, sized as the HTML sized it. */
function applySwap(
	document: DocumentService,
	swap: InstanceSwap,
	meta: ApplyMeta
): { rootId: NodeId; changes: number } {
	const { placeholder } = swap;
	if (placeholder.type === 'PAGE') return { rootId: placeholder.id, changes: 0 };
	const instance = planCreateInstance(document.reader, swap.mainId, {
		parentId: placeholder.parentId ?? undefined,
		index: placeholder.index,
		transform: placeholder.transform
	});
	let changes = document.apply(instance.changes, meta).changes.length;
	const sizing: Record<string, unknown> = {
		layoutPositioning: placeholder.layoutPositioning,
		layoutSizingHorizontal: placeholder.layoutSizingHorizontal,
		layoutSizingVertical: placeholder.layoutSizingVertical
	};
	if (placeholder.layoutSizingHorizontal !== 'HUG') sizing.width = placeholder.width;
	if (placeholder.layoutSizingVertical !== 'HUG') sizing.height = placeholder.height;
	if (swap.name !== undefined) sizing.name = swap.name;
	const set = planSetProps(document.reader, instance.rootId, sizing);
	if (set.length > 0) changes += document.apply(set, meta).changes.length;
	return { rootId: instance.rootId, changes };
}

function changesOf(document: DocumentService, plan: ReconcilePlan): Change[][] {
	const reader = document.reader;
	return [
		planInsertAll(plan.adds),
		plan.moves.map(({ id, parentId, index }) => {
			const node = reader.requireNode(id);
			return {
				t: 'move',
				id,
				parent: parentId,
				index,
				prevParent: node.parentId,
				prevIndex: node.index
			};
		}),
		plan.sets.flatMap(({ id, props }) => planSetProps(reader, id, props))
	];
}

/** Measure, convert, reconcile and apply `html` as one transaction. */
export async function applyHtml(
	services: HtmlServices,
	html: string,
	target: HtmlTarget,
	meta: ApplyMeta
): Promise<ApplyHtmlResult> {
	const { document } = services;
	const placement = placementOf(document, target);
	let replaced: Node[] = [];
	if (target.kind === 'replace') replaced = subtreeOf(document, target.id);
	const css = variableCss(services.variables);
	const snapshot = await services.layout.measure(html, {
		viewportWidth: placement.viewportWidth,
		cssVariables: css.values
	});
	if (snapshot.roots.length === 0) throw new Error('the HTML has no visible element');
	if (target.kind === 'replace' && snapshot.roots.length > 1) {
		throw new Error('replacing a layer takes exactly one root element');
	}
	const first = snapshot.roots[0];
	const origin = placement.origin ?? { x: first.box.x, y: first.box.y };
	const converted = convertSnapshot(snapshot, {
		parentId: placement.parentId,
		origin,
		variables: css.ids,
		reuseIds: new Set(replaced.map((node) => node.id)),
		keepFamilies: textFamilies(replaced),
		defaultFamily: FALLBACK_FAMILY
	});
	if (converted.nodes.length > MAX_LAYERS) {
		throw new Error(
			`the HTML makes ${converted.nodes.length} layers, over the ${MAX_LAYERS} limit; write less at once`
		);
	}
	const plan = planReconcile({
		reader: document.reader,
		nodes: converted.nodes,
		rootIds: converted.rootIds,
		target: placement.target,
		hiddenIds: snapshot.hiddenIds
	});
	const warnings = [...converted.warnings];
	const swaps = instanceSwaps(document, plan, converted.instances, warnings);
	const swapped = new Map<NodeId, NodeId>();
	let changeCount = 0;
	document.transaction(meta, () => {
		const [adds, moves, sets] = changesOf(document, plan);
		if (adds.length > 0) changeCount += document.apply(adds, meta).changes.length;
		for (const swap of swaps) {
			const outcome = applySwap(document, swap, meta);
			swapped.set(swap.placeholder.id, outcome.rootId);
			changeCount += outcome.changes;
		}
		for (const changes of [moves, sets]) {
			if (changes.length > 0) changeCount += document.apply(changes, meta).changes.length;
		}
		for (const id of plan.removes) {
			if (!document.has(id)) continue;
			changeCount += document.apply(planRemove(document.reader, id), meta).changes.length;
		}
	});
	return {
		rootIds: plan.rootIds.map((id) => swapped.get(id) ?? id),
		created: [...plan.adds.map((node) => node.id), ...swapped.values()],
		changed: [
			...new Set([...plan.sets.map((set) => set.id), ...plan.moves.map((move) => move.id)])
		],
		removed: plan.removes,
		changeCount,
		warnings
	};
}
