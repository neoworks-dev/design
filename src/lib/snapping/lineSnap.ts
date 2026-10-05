// Snapping to free lines, pure (#72): lines that belong to no object, such as ruler guides. An x
// line is vertical (a position on the x axis). A line may span only part of the other axis (a
// frame's guide only reaches across its frame): it then takes part only when the moving rectangle
// overlaps that span.

import type { Rect } from '../document/types';
import { ALL_LINES, lineOf, type Axis, type LineKind } from './snap';

export interface SnapLine {
	axis: Axis;
	position: number;
	/** Range on the other axis the line reaches; the whole axis when omitted. */
	span?: { start: number; end: number };
}

export interface LineSnapOptions {
	threshold: number;
	axes?: 'both' | Axis;
	lines?: { x?: readonly LineKind[]; y?: readonly LineKind[] };
}

function overlapsSpan(moving: Rect, line: SnapLine): boolean {
	if (line.span === undefined) return true;
	const crossStart = line.axis === 'x' ? moving.y : moving.x;
	const crossSize = line.axis === 'x' ? moving.height : moving.width;
	return crossStart <= line.span.end && crossStart + crossSize >= line.span.start;
}

function bestShift(
	moving: Rect,
	lines: readonly SnapLine[],
	axis: Axis,
	kinds: readonly LineKind[],
	threshold: number
): number | undefined {
	let best: number | undefined;
	for (const line of lines) {
		if (line.axis !== axis || !overlapsSpan(moving, line)) continue;
		for (const kind of kinds) {
			const shift = line.position - lineOf(moving, axis, kind);
			if (Math.abs(shift) > threshold) continue;
			if (best === undefined || Math.abs(shift) < Math.abs(best)) best = shift;
		}
	}
	return best;
}

/** The shift per axis that puts a line of `moving` on the nearest line within the threshold. */
export function snapToLines(
	moving: Rect,
	lines: readonly SnapLine[],
	options: LineSnapOptions
): { x?: number; y?: number } {
	const axes = options.axes === undefined ? 'both' : options.axes;
	const result: { x?: number; y?: number } = {};
	if (axes !== 'y') {
		const kinds = options.lines?.x === undefined ? ALL_LINES : options.lines.x;
		result.x = bestShift(moving, lines, 'x', kinds, options.threshold);
	}
	if (axes !== 'x') {
		const kinds = options.lines?.y === undefined ? ALL_LINES : options.lines.y;
		result.y = bestShift(moving, lines, 'y', kinds, options.threshold);
	}
	return result;
}
