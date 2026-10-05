// Plans for the position and size fields. Both reuse the gesture code of the canvas handles, so
// typing 200 in the width field does exactly what dragging the handle to 200 does (children
// follow their constraints, text switches to a fixed size).

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type NodeId
} from '../document';
import { ResizeSession, MIN_SIZE } from '../selecting/resize';
import { RotateSession, normalizeAngle, rotationOf, toDegrees } from '../selecting/rotate';
import { isAutoLayoutChild, isPositioned } from '../editing/selectionOps';

const NO_MODIFIERS = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

/** Rotation in degrees of an absolute transform, in the sign convention of the rotate handle. */
export function rotationDegrees(absolute: Matrix2x3): number {
	const degrees = toDegrees(normalizeAngle(rotationOf(absolute)));
	return Math.round(degrees * 100) / 100;
}

/** Set the translation of `id` in its parent's space, keeping rotation and scale. */
export function planMoveTo(
	reader: DocumentReader,
	id: NodeId,
	position: { x?: number; y?: number }
): Change[] {
	const node = reader.requireNode(id);
	if (!isPositioned(node) || isAutoLayoutChild(reader, node)) return [];
	const [[a, c, e], [b, d, f]] = node.transform;
	let x = e;
	let y = f;
	if (position.x !== undefined) x = position.x;
	if (position.y !== undefined) y = position.y;
	const transform: Matrix2x3 = [
		[a, c, x],
		[b, d, y]
	];
	return planSetProps(reader, id, { transform });
}

/** Rotate `id` about its own centre until its orientation is `degrees`. */
export function planRotateTo(reader: DocumentReader, id: NodeId, degrees: number): Change[] {
	const session = new RotateSession(reader, [id]);
	if (session.isEmpty) return [];
	const delta = ((degrees - rotationDegrees(reader.cache.absoluteTransform(id))) * Math.PI) / 180;
	return session.plan(delta).changes;
}

/**
 * Resize `id` to the given width and/or height keeping its top left. With "constrain
 * proportions" on, the other side follows.
 */
export function planResizeTo(
	reader: DocumentReader,
	id: NodeId,
	size: { width?: number; height?: number }
): Change[] {
	const node = reader.requireNode(id);
	if (!isPositioned(node)) return [];
	const session = new ResizeSession(reader, [id]);
	if (session.isEmpty) return [];
	let width = node.width;
	let height = node.height;
	if (size.width !== undefined) width = Math.max(MIN_SIZE, size.width);
	if (size.height !== undefined) height = Math.max(MIN_SIZE, size.height);
	if (node.constrainProportions && node.width > 0 && node.height > 0) {
		if (size.width !== undefined && size.height === undefined) {
			height = (width * node.height) / node.width;
		}
		if (size.height !== undefined && size.width === undefined) {
			width = (height * node.width) / node.height;
		}
	}
	const [[a, c], [b, d]] = reader.cache.absoluteTransform(id);
	const localX = width - node.width;
	const localY = height - node.height;
	const delta = { x: a * localX + c * localY, y: b * localX + d * localY };
	return session.plan({ handle: 'se', delta, modifiers: NO_MODIFIERS }).changes;
}
