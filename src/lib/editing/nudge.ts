// Planning for arrow-key nudges. A nudge moves in screen axes: the node's own rotation does not
// matter, but a rotated ancestor does, because `transform` is stored relative to the parent. The
// screen delta is therefore converted into the parent's space with the inverse of the parent's
// absolute linear part.

import {
	invertMatrix,
	planSetProps,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId
} from '../document';
import { isAutoLayoutChild, isPositioned, topLevelIds } from './selectionOps';

export interface NudgePlan {
	changes: Change[];
	/** Selected nodes that did not move because auto layout owns their position. */
	blockedByAutoLayout: NodeId[];
}

function parentDelta(
	reader: DocumentReader,
	node: Node,
	deltaX: number,
	deltaY: number
): { x: number; y: number } {
	if (node.parentId === null) return { x: deltaX, y: deltaY };
	const inverse = invertMatrix(reader.cache.absoluteTransform(node.parentId));
	if (inverse === null) return { x: deltaX, y: deltaY };
	const [[a, c], [b, d]] = inverse;
	return { x: a * deltaX + c * deltaY, y: b * deltaX + d * deltaY };
}

function translated(transform: Matrix2x3, x: number, y: number): Matrix2x3 {
	const [[a, c, e], [b, d, f]] = transform;
	return [
		[a, c, e + x],
		[b, d, f + y]
	];
}

/** Move the selected nodes by (`deltaX`, `deltaY`) screen pixels. Locked nodes stay put. */
export function planNudge(
	reader: DocumentReader,
	ids: readonly NodeId[],
	deltaX: number,
	deltaY: number
): NudgePlan {
	const plan: NudgePlan = { changes: [], blockedByAutoLayout: [] };
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (!isPositioned(node)) continue;
		if (node.locked) continue;
		if (isAutoLayoutChild(reader, node)) {
			plan.blockedByAutoLayout.push(id);
			continue;
		}
		const delta = parentDelta(reader, node, deltaX, deltaY);
		const transform = translated(node.transform, delta.x, delta.y);
		plan.changes.push(...planSetProps(reader, id, { transform }));
	}
	return plan;
}
