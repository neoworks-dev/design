// Pure layer tree logic for the layers panel: flatten the page into rows (top-most first, which
// is the reverse of the stored sibling order) and answer questions about rows. No Svelte, no
// kernel, so it is unit-tested directly.

import type { NodeId } from '../document';

/** Pixel height of one row; the list is virtualized on it. */
export const LAYER_ROW_HEIGHT = 28;

export interface LayerRow {
	id: NodeId;
	depth: number;
	hasChildren: boolean;
	expanded: boolean;
}

export interface LayerSource {
	/** Child ids in stored order: first is at the bottom of the stack. */
	children(id: NodeId): readonly NodeId[];
}

export interface FlattenOptions {
	isExpanded: (id: NodeId) => boolean;
	/**
	 * When given, only these nodes are listed and every listed container counts as expanded:
	 * the filter shows matches together with their ancestors.
	 */
	only?: ReadonlySet<NodeId>;
}

/** Rows of everything below `rootId` that is visible given the expanded containers. */
export function flattenLayers(
	source: LayerSource,
	rootId: NodeId,
	options: FlattenOptions
): LayerRow[] {
	const rows: LayerRow[] = [];
	appendChildren(source, rootId, 0, options, rows);
	return rows;
}

function appendChildren(
	source: LayerSource,
	parentId: NodeId,
	depth: number,
	options: FlattenOptions,
	rows: LayerRow[]
): void {
	const children = source.children(parentId);
	for (let position = children.length - 1; position >= 0; position -= 1) {
		const id = children[position];
		if (options.only !== undefined && !options.only.has(id)) continue;
		const hasChildren = listedChildCount(source, id, options) > 0;
		const expanded = hasChildren && isOpen(id, options);
		rows.push({ id, depth, hasChildren, expanded });
		if (expanded) appendChildren(source, id, depth + 1, options, rows);
	}
}

function isOpen(id: NodeId, options: FlattenOptions): boolean {
	if (options.only !== undefined) return true;
	return options.isExpanded(id);
}

function listedChildCount(source: LayerSource, id: NodeId, options: FlattenOptions): number {
	const children = source.children(id);
	if (options.only === undefined) return children.length;
	const only = options.only;
	return children.filter((child) => only.has(child)).length;
}

/** Ids from `fromId` to `toId` inclusive in row order; just `toId` when `fromId` is not listed. */
export function rangeBetween(
	rows: readonly LayerRow[],
	fromId: NodeId | null,
	toId: NodeId
): NodeId[] {
	const toPosition = rows.findIndex((row) => row.id === toId);
	const fromPosition = rows.findIndex((row) => row.id === fromId);
	if (toPosition < 0) return [];
	if (fromPosition < 0) return [toId];
	const first = Math.min(fromPosition, toPosition);
	const last = Math.max(fromPosition, toPosition);
	return rows.slice(first, last + 1).map((row) => row.id);
}

/** `id` and every container below it that has children: what Alt+click on a chevron toggles. */
export function containersBelow(source: LayerSource, id: NodeId): NodeId[] {
	const found: NodeId[] = [];
	const pending: NodeId[] = [id];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		const children = source.children(current);
		if (children.length === 0) continue;
		found.push(current);
		pending.push(...children);
	}
	return found;
}
