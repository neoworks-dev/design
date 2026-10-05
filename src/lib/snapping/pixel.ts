// Pixel grid snapping, pure (#71). Given a moving or resized rectangle, the shift per axis that
// puts one of its lines on a whole page coordinate. A move rounds the rectangle's origin (its
// position); a resize rounds the edge being dragged, so the size becomes whole too when the other
// edge already is.

import type { Rect } from '../document/types';
import { lineOf, type Axis, type LineKind, type Point } from './snap';

export interface PixelSnapOptions {
	/** Which axes may snap. Default both. */
	axes?: 'both' | Axis;
	/** The lines being dragged (a resize); omitted for a move, which rounds the origin. */
	lines?: { x?: readonly LineKind[]; y?: readonly LineKind[] };
}

function lineToRound(options: PixelSnapOptions, axis: Axis): LineKind | undefined {
	if (options.lines === undefined) return 'min';
	return options.lines[axis]?.find((kind) => kind !== 'center');
}

/** The shift along `axis` that makes the chosen line whole; 0 when no line takes part. */
export function pixelShift(moving: Rect, axis: Axis, options: PixelSnapOptions = {}): number {
	if (options.axes !== undefined && options.axes !== 'both' && options.axes !== axis) return 0;
	const kind = lineToRound(options, axis);
	if (kind === undefined) return 0;
	const position = lineOf(moving, axis, kind);
	return Math.round(position) - position;
}

export function pixelDelta(moving: Rect, options: PixelSnapOptions = {}): Point {
	return { x: pixelShift(moving, 'x', options), y: pixelShift(moving, 'y', options) };
}
