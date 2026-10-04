// Helpers shared by the selection editing plans. Pure: they read a `DocumentReader` and return
// ids or answers, they never apply anything.

import type { DocumentReader, Node, NodeId, PageNode, Rect } from '../document';

/** Nodes that carry a transform and size: everything except pages. */
export type PositionedNode = Exclude<Node, PageNode>;

export function isPositioned(node: Node): node is PositionedNode {
	return node.type !== 'PAGE';
}

/** Selected ids whose ancestors are not selected too: editing the ancestor already covers them. */
export function topLevelIds(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	const selected = new Set(ids);
	return ids.filter((id) => {
		if (!reader.hasNode(id)) return false;
		return !reader.ancestors(id).some((ancestor) => selected.has(ancestor.id));
	});
}

function indexPath(reader: DocumentReader, id: NodeId): string[] {
	const chain = [reader.requireNode(id), ...reader.ancestors(id)].reverse();
	return chain.map((node) => node.index);
}

function comparePaths(left: string[], right: string[]): number {
	const shared = Math.min(left.length, right.length);
	for (let level = 0; level < shared; level += 1) {
		if (left[level] < right[level]) return -1;
		if (left[level] > right[level]) return 1;
	}
	return left.length - right.length;
}

/** Bottom-most first: document (z) order, also across different parents. */
export function sortByDocumentOrder(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	const keyed = ids.map((id) => ({ id, path: indexPath(reader, id) }));
	keyed.sort((left, right) => comparePaths(left.path, right.path));
	return keyed.map((entry) => entry.id);
}

/** The parent every id shares, or `null` when they differ or there are none. */
export function commonParentId(reader: DocumentReader, ids: readonly NodeId[]): NodeId | null {
	let shared: NodeId | null = null;
	for (const id of ids) {
		const parentId = reader.requireNode(id).parentId;
		if (shared !== null && shared !== parentId) return null;
		shared = parentId;
	}
	return shared;
}

/** Children of an auto layout parent that take part in the flow (not absolutely positioned). */
export function isAutoLayoutChild(reader: DocumentReader, node: Node): boolean {
	if (node.parentId === null) return false;
	const parent = reader.requireNode(node.parentId);
	if (!('layoutMode' in parent)) return false;
	if (parent.layoutMode === 'NONE') return false;
	if (!('layoutPositioning' in node)) return true;
	return node.layoutPositioning !== 'ABSOLUTE';
}

export function unionBounds(rects: Rect[]): Rect {
	const minX = Math.min(...rects.map((rect) => rect.x));
	const minY = Math.min(...rects.map((rect) => rect.y));
	const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
	const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
