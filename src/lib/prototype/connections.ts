// Geometry of prototype connections in screen space: the curve between two rectangles, the
// handle on a selected node, distance tests for picking an arrow. Pure, so it is unit-tested
// without a canvas.

import type { Rect } from '../document/types';

export interface Point {
	x: number;
	y: number;
}

export interface Curve {
	start: Point;
	control1: Point;
	control2: Point;
	end: Point;
}

/** Radius of the round handle, and how far it sits outside the node's right edge. */
export const HANDLE_RADIUS = 6;
export const HANDLE_OFFSET = 16;
/** Press tolerance around handles and arrows, in screen pixels. */
export const PICK_TOLERANCE = 6;

const MIN_CONTROL_DISTANCE = 32;
const CURVE_SAMPLES = 24;

type Side = 'left' | 'right' | 'top' | 'bottom';

function sidePoint(rect: Rect, side: Side): Point {
	if (side === 'left') return { x: rect.x, y: rect.y + rect.height / 2 };
	if (side === 'right') return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
	if (side === 'top') return { x: rect.x + rect.width / 2, y: rect.y };
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function outward(side: Side): Point {
	if (side === 'left') return { x: -1, y: 0 };
	if (side === 'right') return { x: 1, y: 0 };
	if (side === 'top') return { x: 0, y: -1 };
	return { x: 0, y: 1 };
}

function facingSides(from: Rect, to: Rect): { fromSide: Side; toSide: Side } {
	if (to.x >= from.x + from.width) return { fromSide: 'right', toSide: 'left' };
	if (to.x + to.width <= from.x) return { fromSide: 'left', toSide: 'right' };
	if (to.y >= from.y + from.height) return { fromSide: 'bottom', toSide: 'top' };
	if (to.y + to.height <= from.y) return { fromSide: 'top', toSide: 'bottom' };
	return { fromSide: 'right', toSide: 'right' };
}

function distanceBetween(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function curveBetween(start: Point, startSide: Side, end: Point, endSide: Side): Curve {
	const reach = Math.max(MIN_CONTROL_DISTANCE, distanceBetween(start, end) / 2);
	const startNormal = outward(startSide);
	const endNormal = outward(endSide);
	return {
		start,
		control1: { x: start.x + startNormal.x * reach, y: start.y + startNormal.y * reach },
		control2: { x: end.x + endNormal.x * reach, y: end.y + endNormal.y * reach },
		end
	};
}

/** The curve from the facing side of `from` to the facing side of `to`. */
export function connectionCurve(from: Rect, to: Rect): Curve {
	const { fromSide, toSide } = facingSides(from, to);
	return curveBetween(sidePoint(from, fromSide), fromSide, sidePoint(to, toSide), toSide);
}

/** The curve of a connection being dragged: it ends at the pointer and arrives from the left. */
export function dragCurve(from: Rect, pointer: Point): Curve {
	const start = sidePoint(from, 'right');
	const reach = Math.max(MIN_CONTROL_DISTANCE, distanceBetween(start, pointer) / 2);
	return {
		start,
		control1: { x: start.x + reach, y: start.y },
		control2: { x: pointer.x - reach, y: pointer.y },
		end: pointer
	};
}

export function curvePoint(curve: Curve, t: number): Point {
	const u = 1 - t;
	const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
	const points = [curve.start, curve.control1, curve.control2, curve.end];
	let x = 0;
	let y = 0;
	points.forEach((point, index) => {
		x += point.x * weights[index];
		y += point.y * weights[index];
	});
	return { x, y };
}

/** Direction the curve arrives with, in radians (for the arrowhead). */
export function arrivalAngle(curve: Curve): number {
	const before = curvePoint(curve, 0.95);
	return Math.atan2(curve.end.y - before.y, curve.end.x - before.x);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
	const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
	if (lengthSquared === 0) return distanceBetween(point, a);
	const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared;
	const clamped = Math.max(0, Math.min(1, along));
	return distanceBetween(point, { x: a.x + (b.x - a.x) * clamped, y: a.y + (b.y - a.y) * clamped });
}

export function distanceToCurve(curve: Curve, point: Point): number {
	let nearest = Infinity;
	let previous = curve.start;
	for (let step = 1; step <= CURVE_SAMPLES; step += 1) {
		const next = curvePoint(curve, step / CURVE_SAMPLES);
		nearest = Math.min(nearest, distanceToSegment(point, previous, next));
		previous = next;
	}
	return nearest;
}

/** Centre of the connection handle of a node whose screen rectangle is `rect`. */
export function handleCenter(rect: Rect): Point {
	return { x: rect.x + rect.width + HANDLE_OFFSET, y: rect.y + rect.height / 2 };
}

export function hitsHandle(rect: Rect, point: Point): boolean {
	return distanceBetween(handleCenter(rect), point) <= HANDLE_RADIUS + PICK_TOLERANCE / 2;
}

export function containsPoint(rect: Rect, point: Point): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}
