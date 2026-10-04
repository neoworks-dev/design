// Distance measurement, pure (#70): with something selected, Alt+hover another object shows the
// distances between the two on all sides (docs/research/interactions.md section 5, [K]).
//
// Per axis, the selected rectangle S and the target T give either one line across the gap between
// them (they are apart on that axis) or, when their ranges overlap, up to two lines joining the
// matching edges (left to left, right to right), which for a target that contains the selection or
// the other way round are the four insets. Zero-length lines are dropped. Everything is in page
// units; `projectMeasurement` maps lines to screen space, where lengths scale with the zoom but
// the labels keep reading the page distance.

import type { Rect } from '../document/types';
import type { Axis, Point } from './snap';

/** A measurement along `axis` from `start` to `end`, drawn at `cross` on the other axis. */
export interface MeasureLine {
	axis: Axis;
	start: number;
	end: number;
	cross: number;
	/** Page units: `end - start`. */
	distance: number;
	/**
	 * Present when S and T do not overlap on the other axis: a dashed line on the target's edge
	 * (at `at` on this axis) from `cross` to the target's nearest cross edge `to`.
	 */
	extension?: { at: number; to: number };
}

export interface Measurement {
	/** Lines between the selection and the hovered target. */
	target: MeasureLine[];
	/** Lines between the selection and its container, when asked for. */
	container: MeasureLine[];
}

interface Span {
	start: number;
	end: number;
	crossStart: number;
	crossEnd: number;
}

function spanOf(rect: Rect, axis: Axis): Span {
	if (axis === 'x') {
		return {
			start: rect.x,
			end: rect.x + rect.width,
			crossStart: rect.y,
			crossEnd: rect.y + rect.height
		};
	}
	return {
		start: rect.y,
		end: rect.y + rect.height,
		crossStart: rect.x,
		crossEnd: rect.x + rect.width
	};
}

interface EdgePair {
	selectedEdge: number;
	targetEdge: number;
}

function edgePairs(selected: Span, target: Span): EdgePair[] {
	if (selected.end <= target.start) {
		return [{ selectedEdge: selected.end, targetEdge: target.start }];
	}
	if (target.end <= selected.start) {
		return [{ selectedEdge: selected.start, targetEdge: target.end }];
	}
	return [
		{ selectedEdge: selected.start, targetEdge: target.start },
		{ selectedEdge: selected.end, targetEdge: target.end }
	];
}

function lineFor(
	axis: Axis,
	pair: EdgePair,
	selected: Span,
	target: Span
): MeasureLine | undefined {
	const start = Math.min(pair.selectedEdge, pair.targetEdge);
	const end = Math.max(pair.selectedEdge, pair.targetEdge);
	if (end - start <= 0) return undefined;
	const overlapStart = Math.max(selected.crossStart, target.crossStart);
	const overlapEnd = Math.min(selected.crossEnd, target.crossEnd);
	if (overlapStart < overlapEnd) {
		return { axis, start, end, cross: (overlapStart + overlapEnd) / 2, distance: end - start };
	}
	const cross = (selected.crossStart + selected.crossEnd) / 2;
	let nearest = target.crossStart;
	if (target.crossEnd <= selected.crossStart) nearest = target.crossEnd;
	return {
		axis,
		start,
		end,
		cross,
		distance: end - start,
		extension: { at: pair.targetEdge, to: nearest }
	};
}

/** Distance lines between two rectangles in page space. */
export function measureBetween(selected: Rect, target: Rect): MeasureLine[] {
	const lines: MeasureLine[] = [];
	for (const axis of ['x', 'y'] as const) {
		const selectedSpan = spanOf(selected, axis);
		const targetSpan = spanOf(target, axis);
		for (const pair of edgePairs(selectedSpan, targetSpan)) {
			const line = lineFor(axis, pair, selectedSpan, targetSpan);
			if (line) lines.push(line);
		}
	}
	return lines;
}

/** Page-unit distances read as labels: whole numbers plain, otherwise one decimal. */
export function formatDistance(distance: number): string {
	const rounded = Math.round(distance * 10) / 10;
	if (Number.isInteger(rounded)) return String(rounded);
	return rounded.toFixed(1);
}

export interface ScreenMeasureLine {
	from: Point;
	to: Point;
	/** The page distance, formatted; independent of the zoom. */
	label: string;
	labelAt: Point;
	/** Dashed extension to the target's edge, in screen space. */
	extension?: { from: Point; to: Point };
}

function pointOn(axis: Axis, main: number, cross: number): Point {
	if (axis === 'x') return { x: main, y: cross };
	return { x: cross, y: main };
}

/** Maps measurement lines to screen space through `toScreen` (the viewport's world to screen). */
export function projectMeasurement(
	lines: readonly MeasureLine[],
	toScreen: (point: Point) => Point
): ScreenMeasureLine[] {
	return lines.map((line) => {
		const from = toScreen(pointOn(line.axis, line.start, line.cross));
		const to = toScreen(pointOn(line.axis, line.end, line.cross));
		const projected: ScreenMeasureLine = {
			from,
			to,
			label: formatDistance(line.distance),
			labelAt: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
		};
		if (line.extension) {
			projected.extension = {
				from: toScreen(pointOn(line.axis, line.extension.at, line.cross)),
				to: toScreen(pointOn(line.axis, line.extension.at, line.extension.to))
			};
		}
		return projected;
	});
}
