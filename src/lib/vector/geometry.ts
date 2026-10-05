// Pure geometry of vector networks (data-model section 7): sampling, bounds, distances and
// containment in the node's local space. Tangents are stored relative to their vertex.

import type { Matrix2x3, Rect, Vec2, VectorNetwork, VectorSegment } from '../document/types';

export interface Point {
	x: number;
	y: number;
}

export interface CubicControls {
	start: Point;
	firstControl: Point;
	secondControl: Point;
	end: Point;
}

const SAMPLE_STEPS = 24;
const ZERO: Vec2 = { x: 0, y: 0 };

export function copyNetwork(network: VectorNetwork): VectorNetwork {
	return structuredClone(network);
}

/** The value, or an error for an index that should exist (a broken network). */
export function defined<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('vector network index out of range');
	return value;
}

export function tangentOf(tangent: Vec2 | undefined): Vec2 {
	if (tangent) return tangent;
	return ZERO;
}

export function segmentControls(network: VectorNetwork, segment: VectorSegment): CubicControls {
	const start = network.vertices[segment.start];
	const end = network.vertices[segment.end];
	const startTangent = tangentOf(segment.tangentStart);
	const endTangent = tangentOf(segment.tangentEnd);
	return {
		start: { x: start.x, y: start.y },
		firstControl: { x: start.x + startTangent.x, y: start.y + startTangent.y },
		secondControl: { x: end.x + endTangent.x, y: end.y + endTangent.y },
		end: { x: end.x, y: end.y }
	};
}

function isZero(tangent: Vec2 | undefined): boolean {
	if (!tangent) return true;
	return tangent.x === 0 && tangent.y === 0;
}

export function isStraight(segment: VectorSegment): boolean {
	return isZero(segment.tangentStart) && isZero(segment.tangentEnd);
}

export function cubicPoint(controls: CubicControls, t: number): Point {
	const inverse = 1 - t;
	const a = inverse * inverse * inverse;
	const b = 3 * inverse * inverse * t;
	const c = 3 * inverse * t * t;
	const d = t * t * t;
	const { start, firstControl, secondControl, end } = controls;
	return {
		x: a * start.x + b * firstControl.x + c * secondControl.x + d * end.x,
		y: a * start.y + b * firstControl.y + c * secondControl.y + d * end.y
	};
}

/** Points along the segment from its start to its end, including both. */
export function sampleSegment(network: VectorNetwork, segment: VectorSegment): Point[] {
	const controls = segmentControls(network, segment);
	if (isStraight(segment)) return [controls.start, controls.end];
	const points: Point[] = [];
	for (let step = 0; step <= SAMPLE_STEPS; step += 1) {
		points.push(cubicPoint(controls, step / SAMPLE_STEPS));
	}
	return points;
}

export function validSegment(network: VectorNetwork, segment: VectorSegment | undefined): boolean {
	if (!segment) return false;
	return (
		network.vertices[segment.start] !== undefined && network.vertices[segment.end] !== undefined
	);
}

/** Bounds of the drawn curves (sampled, so control points outside the curve do not count). */
export function networkBounds(network: VectorNetwork): Rect | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const include = (point: Point): void => {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	};
	network.vertices.forEach(include);
	for (const segment of network.segments) {
		if (validSegment(network, segment)) sampleSegment(network, segment).forEach(include);
	}
	if (minX === Infinity) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function translateNetwork(
	network: VectorNetwork,
	offsetX: number,
	offsetY: number
): VectorNetwork {
	const moved = copyNetwork(network);
	for (const vertex of moved.vertices) {
		vertex.x += offsetX;
		vertex.y += offsetY;
	}
	return moved;
}

export interface NormalizedNetwork {
	network: VectorNetwork;
	/** Where the new box's top-left corner sat in the old coordinates. */
	origin: Point;
	width: number;
	height: number;
}

/** Shifts the network so its bounds start at (0, 0); the node's transform absorbs the shift. */
export function normalizeNetwork(network: VectorNetwork): NormalizedNetwork {
	const bounds = networkBounds(network);
	if (!bounds) {
		return { network: copyNetwork(network), origin: { x: 0, y: 0 }, width: 0, height: 0 };
	}
	return {
		network: translateNetwork(network, -bounds.x, -bounds.y),
		origin: { x: bounds.x, y: bounds.y },
		width: bounds.width,
		height: bounds.height
	};
}

function mapTangent(tangent: Vec2 | undefined, matrix: Matrix2x3): Vec2 | undefined {
	if (!tangent) return undefined;
	const [[a, c], [b, d]] = matrix;
	return { x: a * tangent.x + c * tangent.y, y: b * tangent.x + d * tangent.y };
}

/** Maps vertices with `matrix` and tangents with its linear part. */
export function transformNetwork(network: VectorNetwork, matrix: Matrix2x3): VectorNetwork {
	const [[a, c, e], [b, d, f]] = matrix;
	const mapped = copyNetwork(network);
	for (const vertex of mapped.vertices) {
		const { x, y } = vertex;
		vertex.x = a * x + c * y + e;
		vertex.y = b * x + d * y + f;
	}
	for (const segment of mapped.segments) {
		const start = mapTangent(segment.tangentStart, matrix);
		const end = mapTangent(segment.tangentEnd, matrix);
		if (start) segment.tangentStart = start;
		if (end) segment.tangentEnd = end;
	}
	return mapped;
}

interface LineClosest {
	t: number;
	distance: number;
}

function closestOnLine(point: Point, from: Point, to: Point): LineClosest {
	const directionX = to.x - from.x;
	const directionY = to.y - from.y;
	const lengthSquared = directionX * directionX + directionY * directionY;
	let t = 0;
	if (lengthSquared > 0) {
		t = ((point.x - from.x) * directionX + (point.y - from.y) * directionY) / lengthSquared;
		t = Math.max(0, Math.min(1, t));
	}
	const distance = Math.hypot(
		point.x - (from.x + directionX * t),
		point.y - (from.y + directionY * t)
	);
	return { t, distance };
}

export interface NearestOnSegment {
	distance: number;
	/** Curve parameter 0..1 (approximate for curves: it follows the sampling). */
	t: number;
	point: Point;
}

export function nearestOnSegment(
	network: VectorNetwork,
	segment: VectorSegment,
	point: Point
): NearestOnSegment {
	const samples = sampleSegment(network, segment);
	const controls = segmentControls(network, segment);
	let best: NearestOnSegment = { distance: Infinity, t: 0, point: samples[0] };
	for (let index = 0; index < samples.length - 1; index += 1) {
		const closest = closestOnLine(point, samples[index], samples[index + 1]);
		if (closest.distance >= best.distance) continue;
		const t = (index + closest.t) / (samples.length - 1);
		best = { distance: closest.distance, t, point: cubicPoint(controls, t) };
	}
	return best;
}

export function distanceToNetwork(network: VectorNetwork, point: Point): number {
	let best = Infinity;
	for (const segment of network.segments) {
		if (!validSegment(network, segment)) continue;
		best = Math.min(best, nearestOnSegment(network, segment, point).distance);
	}
	return best;
}

// ---------- regions ----------

function isForward(
	network: VectorNetwork,
	loop: readonly number[],
	position: number,
	vertex: number
): boolean {
	const segment = network.segments[loop[position]];
	if (vertex !== -1) return segment.start === vertex;
	if (loop.length < 2) return true;
	const following = network.segments[loop[(position + 1) % loop.length]];
	return segment.end === following.start || segment.end === following.end;
}

/** The loop as one polyline, walking its segments end to end whatever their stored direction. */
export function loopPolygon(network: VectorNetwork, loop: readonly number[]): Point[] {
	const polygon: Point[] = [];
	let currentVertex = -1;
	for (let position = 0; position < loop.length; position += 1) {
		const segment = network.segments[loop[position]];
		if (!validSegment(network, segment)) continue;
		const forward = isForward(network, loop, position, currentVertex);
		const points = sampleSegment(network, segment);
		const ordered = forward ? points : [...points].reverse();
		polygon.push(...ordered.slice(0, ordered.length - 1));
		currentVertex = forward ? segment.end : segment.start;
	}
	return polygon;
}

function windingNumber(polygon: readonly Point[], point: Point): number {
	let winding = 0;
	for (let index = 0; index < polygon.length; index += 1) {
		const from = polygon[index];
		const to = polygon[(index + 1) % polygon.length];
		const side = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
		if (from.y <= point.y && to.y > point.y && side > 0) winding += 1;
		if (from.y > point.y && to.y <= point.y && side < 0) winding -= 1;
	}
	return winding;
}

export function regionContains(network: VectorNetwork, regionIndex: number, point: Point): boolean {
	const region = network.regions?.[regionIndex];
	if (!region) return false;
	let winding = 0;
	let enclosing = 0;
	for (const loop of region.loops) {
		const loopWinding = windingNumber(loopPolygon(network, loop), point);
		winding += loopWinding;
		if (loopWinding !== 0) enclosing += 1;
	}
	if (region.windingRule === 'EVENODD') return enclosing % 2 === 1;
	return winding !== 0;
}

/** The topmost (last) region containing the point, or -1. */
export function regionAt(network: VectorNetwork, point: Point): number {
	const regions = network.regions ?? [];
	for (let index = regions.length - 1; index >= 0; index -= 1) {
		if (regionContains(network, index, point)) return index;
	}
	return -1;
}

/**
 * Signed distance to the network's drawn geometry: negative inside a region, otherwise the
 * distance to the nearest segment. Open paths are never inside.
 */
export function networkSignedDistance(network: VectorNetwork, point: Point): number {
	const distance = distanceToNetwork(network, point);
	if (regionAt(network, point) >= 0) return -distance;
	return distance;
}
