// Strokes: weight, cap, join, miter, dashes and alignment. Inside and outside alignment stroke at
// twice the weight and clip to the inside or outside of the fill path, so only the wanted half
// shows. Per-side weights (rectangles only) are drawn as a ring between two rounded rectangles.
// Not yet drawn: arrowhead caps (they draw as flat caps) and dashes on per-side strokes.

import type { Paint as SkiaPaint, PathEffect } from 'canvaskit-wasm';
import {
	roundedRectangleCommands,
	type CornerRadii,
	type PathCommand
} from '../../document/outline';
import type { Stroke, StrokeWeights } from '../../document/types';
import type { DrawContext } from './context';
import { createSkiaPaint } from './paints';
import type { NodeShape, RectangleGeometry } from './shape';
import { skiaPath } from './skiaPath';

/** Returns how many stroke paints were drawn. */
export function drawStrokes(
	context: DrawContext,
	strokes: readonly Stroke[],
	shape: NodeShape
): number {
	let drawn = 0;
	for (const stroke of strokes) drawn += drawStroke(context, stroke, shape);
	return drawn;
}

function drawStroke(context: DrawContext, stroke: Stroke, shape: NodeShape): number {
	const sides = perSideWeights(stroke.weight);
	if (sides !== null && shape.rectangle !== null) {
		return drawPerSideStroke(context, stroke, sides, shape.rectangle, shape);
	}
	const weight = uniformWeight(stroke.weight);
	if (weight <= 0) return 0;
	return drawUniformStroke(context, stroke, weight, shape);
}

function uniformWeight(weight: number | StrokeWeights): number {
	if (typeof weight === 'number') return weight;
	return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

/** Per-side weights, or null when all sides are equal (the cheaper uniform path is exact). */
function perSideWeights(weight: number | StrokeWeights): StrokeWeights | null {
	if (typeof weight === 'number') return null;
	const allEqual =
		weight.top === weight.right && weight.right === weight.bottom && weight.bottom === weight.left;
	if (allEqual) return null;
	return weight;
}

// ---------- uniform weight ----------

function drawUniformStroke(
	context: DrawContext,
	stroke: Stroke,
	weight: number,
	shape: NodeShape
): number {
	const { canvas, canvasKit } = context;
	const align = effectiveAlign(stroke, shape);
	let drawnWidth = weight;
	canvas.save();
	if (align === 'INSIDE' && shape.fillPath) {
		canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Intersect, true);
		drawnWidth = weight * 2;
	}
	if (align === 'OUTSIDE' && shape.fillPath) {
		canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Difference, true);
		drawnWidth = weight * 2;
	}
	const dash = dashEffect(context, stroke.dashPattern);
	let drawn = 0;
	for (const paint of stroke.paints) {
		const skiaPaint = createSkiaPaint(context, paint, shape.size);
		if (skiaPaint === null) continue;
		configureStroke(context, skiaPaint, stroke, drawnWidth, dash);
		canvas.drawPath(shape.strokePath, skiaPaint);
		drawn += 1;
	}
	canvas.restore();
	return drawn;
}

/** Open shapes have no inside: every alignment strokes along the path. */
function effectiveAlign(stroke: Stroke, shape: NodeShape): Stroke['align'] {
	if (!shape.outline.closed || shape.fillPath === null) return 'CENTER';
	return stroke.align;
}

function configureStroke(
	context: DrawContext,
	skiaPaint: SkiaPaint,
	stroke: Stroke,
	width: number,
	dash: PathEffect | null
): void {
	const { canvasKit } = context;
	skiaPaint.setStyle(canvasKit.PaintStyle.Stroke);
	skiaPaint.setStrokeWidth(width);
	skiaPaint.setStrokeCap(strokeCap(context, stroke.cap));
	skiaPaint.setStrokeJoin(strokeJoin(context, stroke.join));
	skiaPaint.setStrokeMiter(stroke.miterLimit);
	if (dash !== null) skiaPaint.setPathEffect(dash);
}

function strokeCap(
	context: DrawContext,
	cap: Stroke['cap']
): ReturnType<SkiaPaint['getStrokeCap']> {
	const { StrokeCap } = context.canvasKit;
	if (cap === 'ROUND') return StrokeCap.Round;
	if (cap === 'SQUARE') return StrokeCap.Square;
	return StrokeCap.Butt;
}

function strokeJoin(
	context: DrawContext,
	join: Stroke['join']
): ReturnType<SkiaPaint['getStrokeJoin']> {
	const { StrokeJoin } = context.canvasKit;
	if (join === 'ROUND') return StrokeJoin.Round;
	if (join === 'BEVEL') return StrokeJoin.Bevel;
	return StrokeJoin.Miter;
}

/** Skia wants an even number of intervals; an odd pattern repeats, as in SVG. */
function dashIntervals(pattern: readonly number[]): number[] | null {
	const valid = pattern.filter((length) => Number.isFinite(length) && length >= 0);
	if (valid.length === 0) return null;
	if (valid.every((length) => length === 0)) return null;
	if (valid.length % 2 === 0) return valid;
	return [...valid, ...valid];
}

function dashEffect(context: DrawContext, pattern: readonly number[]): PathEffect | null {
	const intervals = dashIntervals(pattern);
	if (intervals === null) return null;
	return context.scope.own(context.canvasKit.PathEffect.MakeDash(intervals, 0));
}

// ---------- per-side weights ----------

interface SideOffsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

function scaledSides(weights: StrokeWeights, factor: number): SideOffsets {
	return {
		top: weights.top * factor,
		right: weights.right * factor,
		bottom: weights.bottom * factor,
		left: weights.left * factor
	};
}

/** How far the stroke reaches outside and inside the box edge for each alignment. */
function sideSplit(
	weights: StrokeWeights,
	align: Stroke['align']
): { outward: SideOffsets; inward: SideOffsets } {
	if (align === 'INSIDE')
		return { outward: scaledSides(weights, 0), inward: scaledSides(weights, 1) };
	if (align === 'OUTSIDE')
		return { outward: scaledSides(weights, 1), inward: scaledSides(weights, 0) };
	return { outward: scaledSides(weights, 0.5), inward: scaledSides(weights, 0.5) };
}

/** Radius at each corner grows (outer edge) or shrinks (inner edge) by the adjacent offsets. */
function adjustedRadii(radii: CornerRadii, offsets: SideOffsets, direction: 1 | -1): CornerRadii {
	const adjacent = [
		Math.max(offsets.left, offsets.top),
		Math.max(offsets.top, offsets.right),
		Math.max(offsets.right, offsets.bottom),
		Math.max(offsets.bottom, offsets.left)
	];
	const result: CornerRadii = [0, 0, 0, 0];
	for (let corner = 0; corner < 4; corner += 1) {
		if (radii[corner] <= 0) continue;
		result[corner] = Math.max(0, radii[corner] + direction * adjacent[corner]);
	}
	return result;
}

function ringCommands(
	weights: StrokeWeights,
	align: Stroke['align'],
	rectangle: RectangleGeometry
): PathCommand[] {
	const { outward, inward } = sideSplit(weights, align);
	const { width, height, radii, smoothing } = rectangle;
	const commands = roundedRectangleCommands(
		-outward.left,
		-outward.top,
		width + outward.left + outward.right,
		height + outward.top + outward.bottom,
		adjustedRadii(radii, outward, 1),
		smoothing
	);
	const innerWidth = width - inward.left - inward.right;
	const innerHeight = height - inward.top - inward.bottom;
	if (innerWidth <= 0 || innerHeight <= 0) return commands;
	commands.push(
		...roundedRectangleCommands(
			inward.left,
			inward.top,
			innerWidth,
			innerHeight,
			adjustedRadii(radii, inward, -1),
			smoothing
		)
	);
	return commands;
}

function drawPerSideStroke(
	context: DrawContext,
	stroke: Stroke,
	weights: StrokeWeights,
	rectangle: RectangleGeometry,
	shape: NodeShape
): number {
	const ring = skiaPath(context, ringCommands(weights, stroke.align, rectangle), 'EVENODD');
	let drawn = 0;
	for (const paint of stroke.paints) {
		const skiaPaint = createSkiaPaint(context, paint, shape.size);
		if (skiaPaint === null) continue;
		skiaPaint.setStyle(context.canvasKit.PaintStyle.Fill);
		context.canvas.drawPath(ring, skiaPaint);
		drawn += 1;
	}
	return drawn;
}
