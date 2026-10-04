// Planning for the move gesture. Pure: reads a `DocumentReader`, returns changes. Every call
// plans from the positions the gesture started at (`origin`), so the pointer path never
// accumulates error, and from the document as it is now (parents may already have changed).

import {
	composeMatrices,
	invertMatrix,
	keyBetween,
	planMove,
	planSetProps,
	transformedBounds,
	translationMatrix,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type NodeId,
	type Rect
} from '../document';
import { isAutoLayoutChild, isPositioned } from '../editing/selectionOps';
import type { Point } from '../tools/protocol';

export interface DragItem {
	id: NodeId;
	/** Absolute transform when the gesture started. */
	origin: Matrix2x3;
}

/** Shift: keep only the larger component of the movement. */
export function constrainToAxis(delta: Point): Point {
	if (Math.abs(delta.x) >= Math.abs(delta.y)) return { x: delta.x, y: 0 };
	return { x: 0, y: delta.y };
}

/** The axis a constrained movement runs along, or undefined for free movement. */
export function lockedAxis(delta: Point): 'x' | 'y' {
	if (Math.abs(delta.x) >= Math.abs(delta.y)) return 'x';
	return 'y';
}

/** The nodes of `ids` a drag can move: positioned, unlocked, not placed by auto layout. */
export function draggableIds(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	return ids.filter((id) => {
		const node = reader.requireNode(id);
		if (!isPositioned(node) || node.locked) return false;
		return !isAutoLayoutChild(reader, node);
	});
}

function absoluteOf(reader: DocumentReader, id: NodeId): Matrix2x3 {
	if (reader.requireNode(id).type === 'PAGE')
		return [
			[1, 0, 0],
			[0, 1, 0]
		];
	return reader.cache.absoluteTransform(id);
}

function lastIndexIn(reader: DocumentReader, parentId: NodeId): string | null {
	const last = reader.childNodes(parentId).at(-1);
	if (!last) return null;
	return last.index;
}

/**
 * Changes that put every item at its origin shifted by `delta`, parented to the container
 * `containerFor` names for its new bounds. A node that changes container goes on top of it.
 */
export function planDrag(
	reader: DocumentReader,
	items: readonly DragItem[],
	delta: Point,
	containerFor: (id: NodeId, bounds: Rect) => NodeId
): Change[] {
	const changes: Change[] = [];
	// The next free index per container, so several nodes dropped into one keep their order.
	const tails = new Map<NodeId, string>();
	for (const item of items) {
		const node = reader.requireNode(item.id);
		if (!isPositioned(node)) continue;
		const absolute = composeMatrices(translationMatrix(delta.x, delta.y), item.origin);
		const parentId = containerFor(item.id, transformedBounds(absolute, node.width, node.height));
		if (parentId !== node.parentId) {
			const move = planMove(reader, item.id, parentId, reader.children(parentId).length);
			let tail = lastIndexIn(reader, parentId);
			const planned = tails.get(parentId);
			if (planned !== undefined) tail = planned;
			const index = keyBetween(tail, null);
			tails.set(parentId, index);
			if (move.t === 'move') changes.push({ ...move, index });
		}
		const inverse = invertMatrix(absoluteOf(reader, parentId));
		if (inverse === null) continue;
		changes.push(
			...planSetProps(reader, item.id, { transform: composeMatrices(inverse, absolute) })
		);
	}
	return changes;
}
