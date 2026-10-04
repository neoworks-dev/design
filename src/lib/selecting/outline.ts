// Screen-space geometry for the interim selection overlay (until the overlay layer, #38, draws
// these on the canvas). Pure given the lookups.

import { transformPoint, type Matrix2x3, type NodeId, type Rect } from '../document';
import type { Point } from '../tools/protocol';

export interface OutlineSource {
	size(id: NodeId): { width: number; height: number };
	absoluteTransform(id: NodeId): Matrix2x3;
	worldToScreen(point: Point): Point;
}

/** The four corners of a node on screen, clockwise from its top left; rotation is kept. */
export function screenCorners(source: OutlineSource, id: NodeId): Point[] {
	const { width, height } = source.size(id);
	const transform = source.absoluteTransform(id);
	const corners = [
		transformPoint(transform, 0, 0),
		transformPoint(transform, width, 0),
		transformPoint(transform, width, height),
		transformPoint(transform, 0, height)
	];
	return corners.map((corner) => source.worldToScreen(corner));
}

export function polygonPoints(corners: readonly Point[]): string {
	return corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
}

export function screenRect(rect: Rect, worldToScreen: (point: Point) => Point): Rect {
	const topLeft = worldToScreen({ x: rect.x, y: rect.y });
	const bottomRight = worldToScreen({ x: rect.x + rect.width, y: rect.y + rect.height });
	return {
		x: topLeft.x,
		y: topLeft.y,
		width: bottomRight.x - topLeft.x,
		height: bottomRight.y - topLeft.y
	};
}

const COMPONENT_TYPES: readonly string[] = ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

/** Components and instances are outlined in purple, everything else in blue. */
export function isComponentLike(type: string): boolean {
	return COMPONENT_TYPES.includes(type);
}
