// Geometry of the transform handles: the box they sit on and where each handle is. Pure given
// the lookups. A single node gets its own (possibly rotated) box; several nodes share the
// axis-aligned box around all of them, matching how `ResizeSession` resizes each case.

import {
	transformPoint,
	translationMatrix,
	type DocumentReader,
	type Matrix2x3,
	type NodeId
} from '../document';
import { isPositioned, topLevelIds, unionBounds } from '../editing/selectionOps';
import type { Point } from '../tools/protocol';
import { HANDLE_POSITION, type HandleId } from './resize';

export interface HandleBox {
	/** Box space (origin at its top left) to world space. */
	transform: Matrix2x3;
	width: number;
	height: number;
}

/** The box to put handles on, or undefined when nothing in the selection can be resized. */
export function handleBox(reader: DocumentReader, ids: readonly NodeId[]): HandleBox | undefined {
	const resizable = topLevelIds(reader, ids).filter((id) => {
		const node = reader.requireNode(id);
		return isPositioned(node) && !node.locked;
	});
	if (resizable.length === 0) return undefined;
	if (resizable.length === 1) {
		const node = reader.requireNode(resizable[0]);
		if (!isPositioned(node)) return undefined;
		return {
			transform: reader.cache.absoluteTransform(node.id),
			width: node.width,
			height: node.height
		};
	}
	const bounds = unionBounds(resizable.map((id) => reader.cache.absoluteBounds(id)));
	return {
		transform: translationMatrix(bounds.x, bounds.y),
		width: bounds.width,
		height: bounds.height
	};
}

/** World position of a handle on the box. */
export function handleWorldPoint(box: HandleBox, handle: HandleId): Point {
	const position = HANDLE_POSITION[handle];
	return transformPoint(box.transform, position.u * box.width, position.v * box.height);
}

const CURSORS: Record<HandleId, string> = {
	nw: 'nwse-resize',
	se: 'nwse-resize',
	ne: 'nesw-resize',
	sw: 'nesw-resize',
	n: 'ns-resize',
	s: 'ns-resize',
	e: 'ew-resize',
	w: 'ew-resize'
};

export function cursorFor(handle: HandleId): string {
	return CURSORS[handle];
}

/** "120 x 60", rounded for display. */
export function sizeLabel(size: { width: number; height: number }): string {
	return `${Math.round(size.width)} x ${Math.round(size.height)}`;
}
