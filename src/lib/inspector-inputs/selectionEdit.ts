// The glue every design section uses: read the selection through the variable resolver, name
// the variable a property is bound to, and write through the one mutation path.

import type { Context } from '@neoworks/extension-system';
import { planSetProps, type Change, type DocumentReader, type Node } from '../document';
import { applyEdit } from '../editing/contribute';
import type { NumberGesture } from '../ui/numberField';
import { boundVariableId } from './values';

interface ResolvedSelection {
	revision: number;
	nodes: Node[];
}

// Keyed by the selection's ids array (replaced on every selection change): every section reads
// the selection, so it is resolved once per document revision instead of once per section.
const resolvedSelections = new WeakMap<readonly string[], ResolvedSelection>();

/** Reactive: the selected nodes with bound properties replaced by their resolved values. */
export function selectedNodes(ctx: Context): Node[] {
	const ids = ctx.selection.ids;
	const revision = ctx.document.revision;
	const cached = resolvedSelections.get(ids);
	if (cached !== undefined && cached.revision === revision) return cached.nodes;
	const nodes = resolveSelection(ctx, ids);
	resolvedSelections.set(ids, { revision, nodes });
	return nodes;
}

// The plain reader and resolver: thousands of selected nodes, one service call each.
function resolveSelection(ctx: Context, ids: readonly string[]): Node[] {
	const reader = ctx.document.reader;
	const resolver = ctx.variables.currentResolver();
	return ids.flatMap((id) => {
		if (!reader.hasNode(id)) return [];
		return [resolver.resolvedNode(id)];
	});
}

/** Reactive: name of the variable `property` is bound to on the whole selection. */
export function boundVariableName(
	ctx: Context,
	nodes: readonly Node[],
	property: string
): string | undefined {
	const reader = ctx.document.reader;
	const id = boundVariableId(
		nodes.map((node) => reader.requireNode(node.id)),
		property
	);
	if (id === null) return undefined;
	const variable = ctx.variables.variable(id);
	if (variable === undefined) return id;
	return variable.name;
}

export interface SectionEdit {
	/** Undo step label. */
	label: string;
	/** Scrubbing and stepping coalesce into one undo step under this key. */
	mergeKey: string;
	gesture: NumberGesture;
}

/** Plan changes for every unlocked selected node and apply them as one undo step. */
export function editSelection(
	ctx: Context,
	edit: SectionEdit,
	plan: (reader: DocumentReader, node: Node) => Change[]
): void {
	const reader = ctx.document.reader;
	const changes: Change[] = [];
	for (const id of ctx.selection.ids) {
		const node = reader.requireNode(id);
		if ('locked' in node && node.locked) continue;
		changes.push(...plan(reader, node));
	}
	let mergeKey: string | undefined;
	if (edit.gesture !== 'commit') mergeKey = edit.mergeKey;
	applyEdit(ctx, changes, edit.label, mergeKey);
}

/** The common case: set the same properties on every selected node. */
export function setSelectionProps(
	ctx: Context,
	edit: SectionEdit,
	props: (node: Node) => Record<string, unknown>
): void {
	editSelection(ctx, edit, (reader, node) => planSetProps(reader, node.id, props(node)));
}

/** Reactive: no selected node has an entry in its `property` list (fills, strokes, effects...). */
export function listsAreEmpty(ctx: Context, property: string): boolean {
	return ctx.inspectors.nodes().every((node) => {
		const list: unknown = Reflect.get(node, property);
		if (!Array.isArray(list)) return true;
		return list.length === 0;
	});
}
