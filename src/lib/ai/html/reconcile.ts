// Plans the changes that turn the layers an HTML write replaces into what the HTML describes,
// keeping everything HTML cannot say. Pure: reads the store, returns a plan.
//
// Layers are matched by id (the converter reuses `data-id`s of the replaced subtree). A matched
// layer keeps its id, its type where the new one is compatible, and every property outside what
// HTML expresses (prototype links, plugin data, component links, style ids, export settings). Only
// properties that really changed are set, compared with a tolerance so that rounding through CSS
// (8-bit colours, two-decimal pixels) and font metric differences do not count as edits. Vector
// layers are left as they are. Layers hidden with `display: none` are kept. What is left of the
// replaced subtree is removed.

import {
	generateNodeId,
	keyBetween,
	keysBetween,
	type DocumentReader,
	type Node,
	type NodeId,
	type NodeType,
	type TextStyle
} from '../../document';

export type ReconcileTarget =
	| { kind: 'insert'; parentId: NodeId; lower: string | null; upper: string | null }
	| { kind: 'replace'; id: NodeId };

export interface ReconcileInput {
	reader: DocumentReader;
	/** Converted nodes, parents first; roots have the target's parent. */
	nodes: readonly Node[];
	rootIds: readonly NodeId[];
	target: ReconcileTarget;
	/** `data-id`s of hidden elements: kept untouched. */
	hiddenIds: readonly string[];
	generateId?: () => NodeId;
}

export interface ReconcilePlan {
	/** New layers, parents first, with their final parent and index. */
	adds: Node[];
	moves: { id: NodeId; parentId: NodeId; index: string }[];
	sets: { id: NodeId; props: Record<string, unknown> }[];
	/** Topmost layers to remove (their subtrees go with them). */
	removes: NodeId[];
	rootIds: NodeId[];
}

const VECTOR_TYPES: readonly NodeType[] = [
	'VECTOR',
	'LINE',
	'STAR',
	'POLYGON',
	'BOOLEAN_OPERATION'
];
const FRAME_LIKE: readonly NodeType[] = [
	'FRAME',
	'COMPONENT',
	'COMPONENT_SET',
	'INSTANCE',
	'SECTION',
	'GROUP'
];
const BOX_SHAPES: readonly NodeType[] = ['RECTANGLE', 'ELLIPSE'];

/** Properties HTML can express; the rest of a matched layer is never touched. */
const HTML_PROPERTIES = [
	'name',
	'visible',
	'opacity',
	'blendMode',
	'effects',
	'fills',
	'strokes',
	'cornerRadius',
	'clipsContent',
	'layoutMode',
	'layoutWrap',
	'itemSpacing',
	'counterAxisSpacing',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'primaryAxisSizingMode',
	'counterAxisSizingMode',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'layoutPositioning',
	'minWidth',
	'maxWidth',
	'minHeight',
	'maxHeight',
	'width',
	'height',
	'transform',
	'paragraphs',
	'defaultStyle',
	'textAutoResize',
	'boundVariables'
];

/** What the parent decides about a layer; a replaced root keeps these. */
const PLACEMENT_PROPERTIES = new Set([
	'transform',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'layoutPositioning'
]);

/** Bindings HTML can carry (as `var()`); others on a matched layer are kept. */
const HTML_BINDINGS = new Set([
	'opacity',
	'width',
	'height',
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'cornerRadius'
]);

const TEXT_STYLE_KEYS: readonly (keyof TextStyle)[] = [
	'fontName',
	'fontWeight',
	'fontSize',
	'letterSpacing',
	'lineHeight',
	'textCase',
	'textDecoration',
	'fills'
];

/** Equal up to what a trip through CSS changes: 8-bit colours, rounded pixels. */
export function nearlyEqual(left: unknown, right: unknown): boolean {
	if (typeof left === 'number' && typeof right === 'number') {
		const tolerance = Math.max(0.004, 0.005 * Math.max(Math.abs(left), Math.abs(right)));
		return Math.abs(left - right) <= tolerance;
	}
	if (left === right) return true;
	if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
		return false;
	}
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		const a: unknown = Reflect.get(left, key);
		const b: unknown = Reflect.get(right, key);
		if (a === undefined && b === undefined) continue;
		if (!nearlyEqual(a, b)) return false;
	}
	return true;
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
	const picked: Partial<T> = {};
	for (const key of keys) {
		if (value[key] !== undefined) picked[key] = value[key];
	}
	return picked;
}

type Match = 'update' | 'keep' | 'fresh';

function matchOf(existing: Node, incoming: Node): Match {
	if (VECTOR_TYPES.includes(existing.type)) return 'keep';
	if (existing.type === incoming.type) return 'update';
	if (existing.type === 'TEXT' || incoming.type === 'TEXT') return 'fresh';
	if (FRAME_LIKE.includes(existing.type)) return 'update';
	if (BOX_SHAPES.includes(existing.type) && BOX_SHAPES.includes(incoming.type)) return 'update';
	return 'fresh';
}

function isRotated(node: Node): boolean {
	if (!('transform' in node)) return false;
	return Math.abs(node.transform[0][1]) > 1e-6 || Math.abs(node.transform[1][0]) > 1e-6;
}

function inAutoLayout(parent: Node | undefined, node: Node): boolean {
	if (parent === undefined || !('layoutMode' in parent) || parent.layoutMode === 'NONE')
		return false;
	return !('layoutPositioning' in node) || node.layoutPositioning !== 'ABSOLUTE';
}

class Reconciler {
	private readonly generateId: () => NodeId;
	private readonly oldIds = new Set<NodeId>();
	private readonly incoming = new Map<NodeId, Node>();
	private readonly matches = new Map<NodeId, Match>();
	private readonly kept = new Set<NodeId>();
	private readonly plan: ReconcilePlan = {
		adds: [],
		moves: [],
		sets: [],
		removes: [],
		rootIds: []
	};

	constructor(private readonly input: ReconcileInput) {
		this.generateId = input.generateId ?? generateNodeId;
		const { reader, target } = input;
		if (target.kind === 'replace') {
			this.oldIds.add(target.id);
			for (const node of reader.descendants(target.id)) this.oldIds.add(node.id);
		}
	}

	run(): ReconcilePlan {
		const nodes = this.remapIncompatible();
		for (const node of nodes) this.incoming.set(node.id, node);
		this.keepHidden();
		this.assignIndexes(nodes);
		for (const node of nodes) this.place(node);
		this.collectRemovals();
		return this.plan;
	}

	private old(id: NodeId): Node | undefined {
		if (!this.oldIds.has(id)) return undefined;
		return this.input.reader.getNode(id);
	}

	/** Matches by id; incompatible types get a fresh id, layers below kept vectors are dropped. */
	private remapIncompatible(): Node[] {
		const renamed = new Map<NodeId, NodeId>();
		const dropped = new Set<NodeId>();
		const result: Node[] = [];
		for (const original of this.input.nodes) {
			let parentId = original.parentId;
			if (parentId !== null) {
				if (dropped.has(parentId)) {
					dropped.add(original.id);
					continue;
				}
				parentId = renamed.get(parentId) ?? parentId;
			}
			let node = { ...original, parentId } as Node;
			const existing = this.old(node.id);
			if (existing !== undefined) {
				const match = matchOf(existing, node);
				if (match === 'fresh') {
					const id = this.generateId();
					renamed.set(node.id, id);
					node = { ...node, id } as Node;
				} else {
					this.matches.set(node.id, match);
					this.kept.add(node.id);
				}
				if (match === 'keep') {
					dropped.add(original.id);
					for (const below of this.input.reader.descendants(existing.id)) this.kept.add(below.id);
				}
			}
			result.push(node);
		}
		this.plan.rootIds = this.input.rootIds.map((id) => renamed.get(id) ?? id);
		return result;
	}

	private keepHidden(): void {
		for (const id of this.input.hiddenIds) {
			if (!this.oldIds.has(id)) continue;
			this.kept.add(id);
			for (const below of this.input.reader.descendants(id)) this.kept.add(below.id);
		}
	}

	private readonly indexes = new Map<NodeId, string>();

	private assignIndexes(nodes: readonly Node[]): void {
		const byParent = new Map<NodeId, Node[]>();
		const roots: Node[] = [];
		for (const node of nodes) {
			if (this.plan.rootIds.includes(node.id)) {
				roots.push(node);
				continue;
			}
			if (node.parentId === null) continue;
			const siblings = byParent.get(node.parentId) ?? [];
			siblings.push(node);
			byParent.set(node.parentId, siblings);
		}
		this.assignRootIndexes(roots);
		for (const [parentId, children] of byParent) {
			children.sort((left, right) => (left.index < right.index ? -1 : 1));
			this.assignChildIndexes(parentId, children);
		}
	}

	private assignRootIndexes(roots: Node[]): void {
		const { target, reader } = this.input;
		if (target.kind === 'insert') {
			const keys = keysBetween(target.lower, target.upper, roots.length);
			roots.forEach((root, position) => this.indexes.set(root.id, keys[position]));
			return;
		}
		const replaced = reader.requireNode(target.id);
		const siblings = reader.childNodes(replaced.parentId);
		const next = siblings[siblings.findIndex((sibling) => sibling.id === replaced.id) + 1];
		const [first, ...rest] = roots;
		if (first === undefined) return;
		this.indexes.set(first.id, replaced.index);
		const keys = keysBetween(replaced.index, next === undefined ? null : next.index, rest.length);
		rest.forEach((root, position) => this.indexes.set(root.id, keys[position]));
	}

	/** Keeps existing indexes where the order allows, and fits the others between them. */
	private assignChildIndexes(parentId: NodeId, children: readonly Node[]): void {
		const keptIndex: (string | null)[] = [];
		let last: string | null = null;
		for (const child of children) {
			const existing = this.old(child.id);
			const stays = existing !== undefined && existing.parentId === parentId;
			if (stays && (last === null || existing.index > last)) {
				keptIndex.push(existing.index);
				last = existing.index;
			} else keptIndex.push(null);
		}
		const taken = new Set(
			this.input.reader
				.childNodes(parentId)
				.filter((child) => this.kept.has(child.id))
				.map((child) => child.index)
		);
		let position = 0;
		while (position < children.length) {
			const known = keptIndex[position];
			if (known !== null) {
				this.indexes.set(children[position].id, known);
				position += 1;
				continue;
			}
			let end = position;
			while (end < children.length && keptIndex[end] === null) end += 1;
			const lower = position > 0 ? (keptIndex[position - 1] ?? null) : null;
			const upper = end < children.length ? keptIndex[end] : null;
			const keys = keysBetween(lower, upper, end - position);
			for (let step = 0; step < keys.length; step += 1) {
				let key = keys[step];
				while (taken.has(key))
					key = keyBetween(key, step + 1 < keys.length ? keys[step + 1] : upper);
				taken.add(key);
				this.indexes.set(children[position + step].id, key);
			}
			position = end;
		}
	}

	private parentOf(node: Node): Node | undefined {
		if (node.parentId === null) return undefined;
		return this.incoming.get(node.parentId) ?? this.input.reader.getNode(node.parentId);
	}

	private place(node: Node): void {
		const index = this.indexes.get(node.id) ?? node.index;
		const parentId = node.parentId;
		const existing = this.old(node.id);
		if (existing === undefined) {
			this.plan.adds.push({ ...node, index } as Node);
			return;
		}
		if (parentId !== null && (existing.parentId !== parentId || existing.index !== index)) {
			const isReplacedRoot =
				this.plan.rootIds[0] === node.id && this.input.target.kind === 'replace';
			if (!isReplacedRoot) this.plan.moves.push({ id: node.id, parentId, index });
		}
		if (this.matches.get(node.id) !== 'update') return;
		const props = this.changedProps(existing, node);
		if (Object.keys(props).length > 0) this.plan.sets.push({ id: node.id, props });
	}

	private changedProps(existing: Node, incoming: Node): Record<string, unknown> {
		const isReplacedRoot =
			this.input.target.kind === 'replace' && this.plan.rootIds[0] === incoming.id;
		const parent = this.parentOf(incoming);
		const props: Record<string, unknown> = {};
		for (const key of HTML_PROPERTIES) {
			if (!(key in existing)) continue;
			if (isReplacedRoot && PLACEMENT_PROPERTIES.has(key)) continue;
			const before: unknown = Reflect.get(existing, key);
			const after = this.incomingValue(existing, incoming, key, parent);
			if (after === undefined) continue;
			if (nearlyEqual(before, after)) continue;
			props[key] = after;
		}
		return props;
	}

	private incomingValue(
		existing: Node,
		incoming: Node,
		key: string,
		parent: Node | undefined
	): unknown {
		const value: unknown = Reflect.get(incoming, key);
		if (key === 'transform') return this.transformOf(existing, incoming, parent);
		if (key === 'width' || key === 'height') return this.sizeOf(incoming, key, parent);
		if (key === 'boundVariables') return this.bindingsOf(existing, incoming);
		if (key === 'defaultStyle' && existing.type === 'TEXT' && incoming.type === 'TEXT') {
			return { ...existing.defaultStyle, ...pick(incoming.defaultStyle, TEXT_STYLE_KEYS) };
		}
		if (key === 'paragraphs' && existing.type === 'TEXT' && incoming.type === 'TEXT') {
			const shape = (node: typeof existing): unknown =>
				node.paragraphs.map((paragraph) => ({
					align: paragraph.align,
					runs: paragraph.runs.map((run) => ({
						text: run.text,
						style: pick(run.style, TEXT_STYLE_KEYS)
					}))
				}));
			if (nearlyEqual(shape(existing), shape(incoming))) return undefined;
			return value;
		}
		return value;
	}

	private transformOf(existing: Node, incoming: Node, parent: Node | undefined): unknown {
		if (!('transform' in existing) || !('transform' in incoming)) return undefined;
		if (isRotated(existing)) return undefined;
		if (inAutoLayout(parent, incoming)) return undefined;
		return incoming.transform;
	}

	/** Sizes the layout engine recomputes (hug, fill, auto-sized text) are not compared. */
	private sizeOf(incoming: Node, axis: 'width' | 'height', parent: Node | undefined): unknown {
		if (!('layoutSizingHorizontal' in incoming)) return Reflect.get(incoming, axis);
		const sizing =
			axis === 'width' ? incoming.layoutSizingHorizontal : incoming.layoutSizingVertical;
		if (sizing === 'HUG') return undefined;
		if (sizing === 'FILL' && inAutoLayout(parent, incoming)) return undefined;
		if (incoming.type === 'TEXT') {
			if (incoming.textAutoResize === 'WIDTH_AND_HEIGHT') return undefined;
			if (axis === 'height' && incoming.textAutoResize === 'HEIGHT') return undefined;
		}
		return incoming[axis];
	}

	private bindingsOf(existing: Node, incoming: Node): unknown {
		const merged: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(existing.boundVariables ?? {})) {
			if (!HTML_BINDINGS.has(key)) merged[key] = value;
		}
		Object.assign(merged, incoming.boundVariables ?? {});
		if (Object.keys(merged).length === 0 && existing.boundVariables === undefined) return undefined;
		return merged;
	}

	private collectRemovals(): void {
		for (const id of this.oldIds) {
			if (this.kept.has(id)) continue;
			const node = this.input.reader.getNode(id);
			if (node === undefined) continue;
			const parentRemoved =
				node.parentId !== null && this.oldIds.has(node.parentId) && !this.kept.has(node.parentId);
			if (!parentRemoved) this.plan.removes.push(id);
		}
	}
}

export function planReconcile(input: ReconcileInput): ReconcilePlan {
	return new Reconciler(input).run();
}
