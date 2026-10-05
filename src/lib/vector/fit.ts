// Least-squares cubic curve fitting for freehand strokes (Schneider, "An Algorithm for
// Automatically Fitting Digitized Curves", Graphics Gems, 1990), used by the pencil tool.

import type { VectorNetwork } from '../document/types';
import { cubicPoint, type CubicControls, type Point } from './geometry';
import { appendVertex, connectVertices, emptyNetwork } from './network';

const MAX_REPARAMETERIZE_ROUNDS = 4;

function minus(left: Point, right: Point): Point {
	return { x: left.x - right.x, y: left.y - right.y };
}

function plus(left: Point, right: Point): Point {
	return { x: left.x + right.x, y: left.y + right.y };
}

function scale(point: Point, factor: number): Point {
	return { x: point.x * factor, y: point.y * factor };
}

function dot(left: Point, right: Point): number {
	return left.x * right.x + left.y * right.y;
}

function normalized(point: Point): Point {
	const length = Math.hypot(point.x, point.y);
	if (length === 0) return { x: 0, y: 0 };
	return scale(point, 1 / length);
}

function withoutDuplicates(points: readonly Point[]): Point[] {
	const unique: Point[] = [];
	for (const point of points) {
		const previous = unique.at(-1);
		if (previous && previous.x === point.x && previous.y === point.y) continue;
		unique.push(point);
	}
	return unique;
}

/** Fits cubic curves through `points`; each curve stays within `tolerance` of its points. */
export function fitCurves(points: readonly Point[], tolerance: number): CubicControls[] {
	const unique = withoutDuplicates(points);
	if (unique.length < 2) return [];
	const last = unique.length - 1;
	const startTangent = normalized(minus(unique[1], unique[0]));
	const endTangent = normalized(minus(unique[last - 1], unique[last]));
	return fitRange(unique, 0, last, startTangent, endTangent, tolerance * tolerance);
}

function fitRange(
	points: readonly Point[],
	first: number,
	last: number,
	startTangent: Point,
	endTangent: Point,
	squaredTolerance: number
): CubicControls[] {
	if (last - first === 1)
		return [straightCurve(points[first], points[last], startTangent, endTangent)];
	let parameters = chordLengthParameters(points, first, last);
	let curve = generateBezier(points, first, last, parameters, startTangent, endTangent);
	let worst = maxError(points, first, last, curve, parameters);
	if (worst.error < squaredTolerance) return [curve];
	for (
		let round = 0;
		round < MAX_REPARAMETERIZE_ROUNDS && worst.error < squaredTolerance * 16;
		round += 1
	) {
		parameters = reparameterize(points, first, last, parameters, curve);
		curve = generateBezier(points, first, last, parameters, startTangent, endTangent);
		worst = maxError(points, first, last, curve, parameters);
		if (worst.error < squaredTolerance) return [curve];
	}
	const split = first + worst.index;
	const centerTangent = normalized(minus(points[split - 1], points[split + 1]));
	return [
		...fitRange(points, first, split, startTangent, centerTangent, squaredTolerance),
		...fitRange(points, split, last, scale(centerTangent, -1), endTangent, squaredTolerance)
	];
}

function straightCurve(
	start: Point,
	end: Point,
	startTangent: Point,
	endTangent: Point
): CubicControls {
	const reach = Math.hypot(end.x - start.x, end.y - start.y) / 3;
	return {
		start,
		firstControl: plus(start, scale(startTangent, reach)),
		secondControl: plus(end, scale(endTangent, reach)),
		end
	};
}

function chordLengthParameters(points: readonly Point[], first: number, last: number): number[] {
	const parameters = [0];
	for (let index = first + 1; index <= last; index += 1) {
		const step = Math.hypot(
			points[index].x - points[index - 1].x,
			points[index].y - points[index - 1].y
		);
		parameters.push(parameters[parameters.length - 1] + step);
	}
	const total = parameters[parameters.length - 1];
	return parameters.map((value) => (total === 0 ? 0 : value / total));
}

function bernstein(t: number): [number, number, number, number] {
	const inverse = 1 - t;
	return [inverse * inverse * inverse, 3 * inverse * inverse * t, 3 * inverse * t * t, t * t * t];
}

function generateBezier(
	points: readonly Point[],
	first: number,
	last: number,
	parameters: readonly number[],
	startTangent: Point,
	endTangent: Point
): CubicControls {
	const start = points[first];
	const end = points[last];
	let c00 = 0;
	let c01 = 0;
	let c11 = 0;
	let x0 = 0;
	let x1 = 0;
	for (let index = 0; index < parameters.length; index += 1) {
		const [b0, b1, b2, b3] = bernstein(parameters[index]);
		const a0 = scale(startTangent, b1);
		const a1 = scale(endTangent, b2);
		c00 += dot(a0, a0);
		c01 += dot(a0, a1);
		c11 += dot(a1, a1);
		const target = minus(points[first + index], plus(scale(start, b0 + b1), scale(end, b2 + b3)));
		x0 += dot(a0, target);
		x1 += dot(a1, target);
	}
	const determinant = c00 * c11 - c01 * c01;
	const distance = Math.hypot(end.x - start.x, end.y - start.y);
	const epsilon = 1e-6 * distance;
	let alphaStart = 0;
	let alphaEnd = 0;
	if (Math.abs(determinant) > 1e-12) {
		alphaStart = (x0 * c11 - x1 * c01) / determinant;
		alphaEnd = (c00 * x1 - c01 * x0) / determinant;
	}
	if (alphaStart < epsilon || alphaEnd < epsilon) {
		alphaStart = distance / 3;
		alphaEnd = distance / 3;
	}
	return {
		start,
		firstControl: plus(start, scale(startTangent, alphaStart)),
		secondControl: plus(end, scale(endTangent, alphaEnd)),
		end
	};
}

function maxError(
	points: readonly Point[],
	first: number,
	last: number,
	curve: CubicControls,
	parameters: readonly number[]
): { error: number; index: number } {
	let worst = 0;
	let worstIndex = Math.floor((last - first + 1) / 2);
	for (let index = 1; index < last - first; index += 1) {
		const fitted = cubicPoint(curve, parameters[index]);
		const offset = minus(fitted, points[first + index]);
		const squared = dot(offset, offset);
		if (squared >= worst) {
			worst = squared;
			worstIndex = index;
		}
	}
	return { error: worst, index: Math.min(Math.max(worstIndex, 1), last - first - 1) };
}

function reparameterize(
	points: readonly Point[],
	first: number,
	last: number,
	parameters: readonly number[],
	curve: CubicControls
): number[] {
	return parameters.map((t, index) => newtonRaphson(curve, points[first + index], t));
}

function newtonRaphson(curve: CubicControls, point: Point, t: number): number {
	const position = cubicPoint(curve, t);
	const firstDerivative = derivativePoints(curve);
	const velocity = quadraticPoint(firstDerivative, t);
	const acceleration = linearPoint(
		[minus(firstDerivative[1], firstDerivative[0]), minus(firstDerivative[2], firstDerivative[1])],
		t
	);
	const offset = minus(position, point);
	const numerator = dot(offset, velocity);
	const denominator = dot(velocity, velocity) + dot(offset, acceleration);
	if (denominator === 0) return t;
	return Math.min(1, Math.max(0, t - numerator / denominator));
}

function derivativePoints(curve: CubicControls): [Point, Point, Point] {
	return [
		scale(minus(curve.firstControl, curve.start), 3),
		scale(minus(curve.secondControl, curve.firstControl), 3),
		scale(minus(curve.end, curve.secondControl), 3)
	];
}

function quadraticPoint(points: [Point, Point, Point], t: number): Point {
	const inverse = 1 - t;
	return plus(
		plus(scale(points[0], inverse * inverse), scale(points[1], 2 * inverse * t)),
		scale(points[2], t * t)
	);
}

function linearPoint(points: [Point, Point], t: number): Point {
	return plus(scale(points[0], (1 - t) * 2), scale(points[1], t * 2));
}

/** Fitted curves as an open vector network: one vertex per joint, tangents relative to them. */
export function curvesToNetwork(curves: readonly CubicControls[]): VectorNetwork {
	const network = emptyNetwork();
	if (curves.length === 0) return network;
	let previous = appendVertex(network, curves[0].start);
	for (const curve of curves) {
		const next = appendVertex(network, curve.end);
		connectVertices(
			network,
			previous,
			next,
			minus(curve.firstControl, curve.start),
			minus(curve.secondControl, curve.end)
		);
		previous = next;
	}
	return network;
}

/** Freehand points to a smooth open network; `tolerance` is the largest allowed deviation. */
export function fitFreehand(points: readonly Point[], tolerance: number): VectorNetwork {
	return curvesToNetwork(fitCurves(points, tolerance));
}
