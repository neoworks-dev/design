// Marquee selection rules (docs/research/interactions.md section 3). Pure: reads a
// `DocumentReader`, returns ids.
//
//   scoped    children of the scope container whose box meets the rectangle; groups and nested
//             frames count as units. A top-level frame is selected only when the rectangle
//             contains it entirely, otherwise its children are marquee-selected instead.
//   deep      Ctrl+drag: every leaf that meets the rectangle, whatever the scope.
//
// Overlap uses the absolute (axis-aligned) bounds of a node, so a rotated node can be picked by
// the empty corner of its bounds; exact geometry is a later refinement.

import {
	canHaveChildren,
	isFrameLike,
	type DocumentReader,
	type Node,
	type NodeId,
	type Rect
} from '../document';

export interface MarqueeQuery {
	pageId: NodeId;
	/** The container whose children are candidates; the page when unscoped. */
	scopeId: NodeId;
	rect: Rect;
	deep: boolean;
}

export function rectsOverlap(first: Rect, second: Rect): boolean {
	if (first.x > second.x + second.width || second.x > first.x + first.width) return false;
	return !(first.y > second.y + second.height || second.y > first.y + first.height);
}

export function rectContains(outer: Rect, inner: Rect): boolean {
	if (inner.x < outer.x || inner.y < outer.y) return false;
	if (inner.x + inner.width > outer.x + outer.width) return false;
	return inner.y + inner.height <= outer.y + outer.height;
}

export function isSelectable(node: Node): boolean {
	if (node.type === 'PAGE') return false;
	return node.visible && !node.locked;
}

function hasChildren(reader: DocumentReader, node: Node): boolean {
	return canHaveChildren(node.type) && reader.children(node.id).length > 0;
}

export function marqueeSelect(reader: DocumentReader, query: MarqueeQuery): NodeId[] {
	const found: NodeId[] = [];
	if (query.deep) collectLeaves(reader, query.pageId, query.rect, found);
	else collectScoped(reader, query, found);
	return found;
}

function collectLeaves(reader: DocumentReader, parentId: NodeId, rect: Rect, out: NodeId[]): void {
	for (const id of reader.children(parentId)) {
		const node = reader.requireNode(id);
		if (!isSelectable(node)) continue;
		if (!rectsOverlap(reader.cache.absoluteBounds(id), rect)) continue;
		if (hasChildren(reader, node)) collectLeaves(reader, id, rect, out);
		else out.push(id);
	}
}

function collectScoped(reader: DocumentReader, query: MarqueeQuery, out: NodeId[]): void {
	for (const id of reader.children(query.scopeId)) {
		const node = reader.requireNode(id);
		if (!isSelectable(node)) continue;
		const bounds = reader.cache.absoluteBounds(id);
		if (!rectsOverlap(bounds, query.rect)) continue;
		const topLevelFrame = node.parentId === query.pageId && isFrameLike(node);
		if (!topLevelFrame) {
			out.push(id);
			continue;
		}
		if (rectContains(query.rect, bounds)) {
			out.push(id);
			continue;
		}
		collectScoped(reader, { ...query, scopeId: id }, out);
	}
}

/** `before` with every id of `marquee` toggled: Shift+marquee. */
export function toggleInto(before: readonly NodeId[], marquee: readonly NodeId[]): NodeId[] {
	const toggled = new Set(marquee);
	const kept = before.filter((id) => !toggled.has(id));
	const added = marquee.filter((id) => !before.includes(id));
	return [...kept, ...added];
}

export function rectBetween(
	first: { x: number; y: number },
	second: { x: number; y: number }
): Rect {
	return {
		x: Math.min(first.x, second.x),
		y: Math.min(first.y, second.y),
		width: Math.abs(first.x - second.x),
		height: Math.abs(first.y - second.y)
	};
}
