// Gradient editing maths: stops, and the three on-canvas handles of a gradient paint. Pure.
//
// `gradientTransform` maps the node's normalized box (0..1) to gradient space (see
// renderer/draw/paintShaders.ts), so the handles live at the images of fixed gradient-space
// anchors under its inverse M (gradient space to normalized box):
//
//   linear                        start (0, .5)  end (1, .5)  width (0, 1)
//   radial, angular, diamond      centre (.5, .5) end (1, .5)  width (.5, 1)
//
// Dragging a handle rebuilds M from the three points and stores its inverse.

import { invertMatrix, transformPoint } from '../document/matrix';
import type { ColorStop, GradientPaint, Matrix2x3, RGBA, Vec2 } from '../document/types';

export type GradientType = GradientPaint['type'];
export type HandleName = 'origin' | 'end' | 'width';

export const GRADIENT_TYPES: GradientType[] = [
	'GRADIENT_LINEAR',
	'GRADIENT_RADIAL',
	'GRADIENT_ANGULAR',
	'GRADIENT_DIAMOND'
];

interface Anchors {
	origin: Vec2;
	end: Vec2;
	width: Vec2;
}

function anchorsOf(type: GradientType): Anchors {
	if (type === 'GRADIENT_LINEAR') {
		return { origin: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, width: { x: 0, y: 1 } };
	}
	return { origin: { x: 0.5, y: 0.5 }, end: { x: 1, y: 0.5 }, width: { x: 0.5, y: 1 } };
}

export interface HandlePoints {
	origin: Vec2;
	end: Vec2;
	width: Vec2;
}

/** The handles in the node's normalized box. */
export function handlePoints(paint: GradientPaint): HandlePoints {
	const inverse = invertMatrix(paint.gradientTransform);
	const anchors = anchorsOf(paint.type);
	if (inverse === null) return anchors;
	return {
		origin: transformPoint(inverse, anchors.origin.x, anchors.origin.y),
		end: transformPoint(inverse, anchors.end.x, anchors.end.y),
		width: transformPoint(inverse, anchors.width.x, anchors.width.y)
	};
}

/** The transform whose handles are at `points`. */
export function transformFromHandles(type: GradientType, points: HandlePoints): Matrix2x3 {
	const anchors = anchorsOf(type);
	const alongX = {
		x: (points.end.x - points.origin.x) / (anchors.end.x - anchors.origin.x),
		y: (points.end.y - points.origin.y) / (anchors.end.x - anchors.origin.x)
	};
	const alongY = {
		x: (points.width.x - points.origin.x) / (anchors.width.y - anchors.origin.y),
		y: (points.width.y - points.origin.y) / (anchors.width.y - anchors.origin.y)
	};
	const offset = {
		x: points.origin.x - anchors.origin.x * alongX.x - anchors.origin.y * alongY.x,
		y: points.origin.y - anchors.origin.x * alongX.y - anchors.origin.y * alongY.y
	};
	const toNormalized: Matrix2x3 = [
		[alongX.x, alongY.x, offset.x],
		[alongX.y, alongY.y, offset.y]
	];
	const inverse = invertMatrix(toNormalized);
	if (inverse === null) return defaultGradientTransform();
	return inverse;
}

/** A fresh gradient across the whole box: identity puts every type's anchors on the box. */
export function defaultGradientTransform(): Matrix2x3 {
	return [
		[1, 0, 0],
		[0, 1, 0]
	];
}

/** Move one handle to `point` (normalized box). Linear start keeps the end; others move whole. */
export function moveHandle(paint: GradientPaint, handle: HandleName, point: Vec2): GradientPaint {
	const points = handlePoints(paint);
	let next: HandlePoints = { ...points };
	if (handle === 'end') next.end = point;
	if (handle === 'width') next.width = point;
	if (handle === 'origin') {
		const shift = { x: point.x - points.origin.x, y: point.y - points.origin.y };
		next = { origin: point, end: points.end, width: translate(points.width, shift) };
		if (paint.type !== 'GRADIENT_LINEAR') next.end = translate(points.end, shift);
	}
	return { ...paint, gradientTransform: transformFromHandles(paint.type, next) };
}

function translate(point: Vec2, shift: Vec2): Vec2 {
	return { x: point.x + shift.x, y: point.y + shift.y };
}

/** Rotate the handles a quarter turn about the box centre, in pixels so squares stay square. */
export function rotateGradient(
	paint: GradientPaint,
	size: { width: number; height: number }
): GradientPaint {
	const points = handlePoints(paint);
	const rotate = (point: Vec2): Vec2 => {
		const x = (point.x - 0.5) * size.width;
		const y = (point.y - 0.5) * size.height;
		return { x: 0.5 - y / size.width, y: 0.5 + x / size.height };
	};
	const next = {
		origin: rotate(points.origin),
		end: rotate(points.end),
		width: rotate(points.width)
	};
	return { ...paint, gradientTransform: transformFromHandles(paint.type, next) };
}

/** Swap start and end: stop positions mirror, order stays ascending. */
export function reverseStops(stops: readonly ColorStop[]): ColorStop[] {
	return stops.map((stop) => ({ ...stop, position: 1 - stop.position })).reverse();
}

function mixChannel(first: number, second: number, amount: number): number {
	return first + (second - first) * amount;
}

/** The gradient's colour at `position`, interpolated between neighbouring stops. */
export function colorAt(stops: readonly ColorStop[], position: number): RGBA {
	const first = stops[0];
	const last = stops[stops.length - 1];
	if (position <= first.position) return first.color;
	if (position >= last.position) return last.color;
	for (let index = 1; index < stops.length; index++) {
		const after = stops[index];
		if (position > after.position) continue;
		const before = stops[index - 1];
		const span = after.position - before.position;
		let amount = 0;
		if (span > 0) amount = (position - before.position) / span;
		return {
			r: mixChannel(before.color.r, after.color.r, amount),
			g: mixChannel(before.color.g, after.color.g, amount),
			b: mixChannel(before.color.b, after.color.b, amount),
			a: mixChannel(before.color.a, after.color.a, amount)
		};
	}
	return last.color;
}

/** Insert a stop at `position` with the colour already there; returns the new stops and index. */
export function addStop(
	stops: readonly ColorStop[],
	position: number
): { stops: ColorStop[]; index: number } {
	const color = colorAt(stops, position);
	const index = stops.findIndex((stop) => stop.position > position);
	const at = index < 0 ? stops.length : index;
	const next = [...stops];
	next.splice(at, 0, { position, color });
	return { stops: next, index: at };
}

/** Remove a stop; a gradient keeps at least two. */
export function removeStop(stops: readonly ColorStop[], index: number): ColorStop[] {
	if (stops.length <= 2) return [...stops];
	return stops.filter((_, position) => position !== index);
}

/** Move a stop, clamped between its neighbours so the order never changes. */
export function moveStop(
	stops: readonly ColorStop[],
	index: number,
	position: number
): ColorStop[] {
	let low = 0;
	let high = 1;
	if (index > 0) low = stops[index - 1].position;
	if (index < stops.length - 1) high = stops[index + 1].position;
	const clamped = Math.min(high, Math.max(low, position));
	return stops.map((stop, at) => {
		if (at !== index) return stop;
		return { ...stop, position: clamped };
	});
}

/** Position along the gradient axis (start to end, or centre to end) of a normalized point. */
export function positionAlongAxis(paint: GradientPaint, point: Vec2): number {
	const points = handlePoints(paint);
	const axis = { x: points.end.x - points.origin.x, y: points.end.y - points.origin.y };
	const lengthSquared = axis.x * axis.x + axis.y * axis.y;
	if (lengthSquared === 0) return 0;
	const along = (point.x - points.origin.x) * axis.x + (point.y - points.origin.y) * axis.y;
	return along / lengthSquared;
}

/** Whether stops can be dragged on the canvas (angular stops sit on an angle, not an axis). */
export function hasAxisStops(type: GradientType): boolean {
	return type !== 'GRADIENT_ANGULAR';
}

/** CSS preview of the stops, left to right, over transparency. */
export function stopsCss(stops: readonly ColorStop[]): string {
	const parts = stops.map((stop) => {
		const { r, g, b, a } = stop.color;
		const byte = (channel: number): number => Math.round(channel * 255);
		return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${a}) ${stop.position * 100}%`;
	});
	return `linear-gradient(to right, ${parts.join(', ')})`;
}
