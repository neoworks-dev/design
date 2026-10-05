// Where a dragged child lands in an auto layout frame: the slot among the other children and the
// line the blue insertion indicator is drawn along. Pure: rectangles and a point in, a slot out.
// All coordinates share one space (the page).

import type { Rect } from '../document/types';

export interface Point {
	x: number;
	y: number;
}

export interface DropSlot {
	/** Position among the children without the dragged ones (0 puts it first). */
	index: number;
	/** The indicator: a line across the slot. */
	line: { from: Point; to: Point };
}

export interface DropRequest {
	mode: 'HORIZONTAL' | 'VERTICAL';
	wrap: boolean;
	/** Flow children without the dragged ones, in stacking order, where they are laid out now. */
	rects: readonly Rect[];
	/** The frame's content box (inside the padding): where an empty frame puts the line. */
	inner: Rect;
	point: Point;
}

interface Line {
	/** Position of the first rectangle of the line among all rectangles. */
	start: number;
	rects: Rect[];
	top: number;
	bottom: number;
}

/** Flip x and y so one implementation serves both directions. */
function transposeRect(rect: Rect): Rect {
	return { x: rect.y, y: rect.x, width: rect.height, height: rect.width };
}

function transposePoint(point: Point): Point {
	return { x: point.y, y: point.x };
}

export function dropSlot(request: DropRequest): DropSlot {
	if (request.mode === 'HORIZONTAL') return horizontalSlot(request);
	const slot = horizontalSlot({
		...request,
		wrap: false,
		rects: request.rects.map(transposeRect),
		inner: transposeRect(request.inner),
		point: transposePoint(request.point)
	});
	return {
		index: slot.index,
		line: { from: transposePoint(slot.line.from), to: transposePoint(slot.line.to) }
	};
}

/** Rectangles that follow each other on one row share a line; a rectangle below starts the next. */
export function splitIntoLines(rects: readonly Rect[]): Line[] {
	const lines: Line[] = [];
	rects.forEach((rect, position) => {
		const current = lines.at(-1);
		if (current !== undefined && rect.y < current.bottom - 0.5) {
			current.rects.push(rect);
			current.top = Math.min(current.top, rect.y);
			current.bottom = Math.max(current.bottom, rect.y + rect.height);
			return;
		}
		lines.push({ start: position, rects: [rect], top: rect.y, bottom: rect.y + rect.height });
	});
	return lines;
}

function distanceToBand(value: number, top: number, bottom: number): number {
	if (value < top) return top - value;
	if (value > bottom) return value - bottom;
	return 0;
}

function pickLine(lines: Line[], y: number): Line {
	let best = lines[0];
	let bestDistance = Infinity;
	for (const line of lines) {
		const distance = distanceToBand(y, line.top, line.bottom);
		if (distance < bestDistance) {
			best = line;
			bestDistance = distance;
		}
	}
	return best;
}

function horizontalSlot(request: DropRequest): DropSlot {
	const { rects, inner, point } = request;
	if (rects.length === 0) {
		return {
			index: 0,
			line: {
				from: { x: inner.x, y: inner.y },
				to: { x: inner.x, y: inner.y + inner.height }
			}
		};
	}
	let line: Line = {
		start: 0,
		rects: [...rects],
		top: Math.min(...rects.map((rect) => rect.y)),
		bottom: Math.max(...rects.map((rect) => rect.y + rect.height))
	};
	if (request.wrap) line = pickLine(splitIntoLines(rects), point.y);
	const before = line.rects.filter((rect) => rect.x + rect.width / 2 < point.x).length;
	const previous = line.rects[before - 1];
	const next = line.rects[before];
	const x = slotX(previous, next);
	return {
		index: line.start + before,
		line: { from: { x, y: line.top }, to: { x, y: line.bottom } }
	};
}

function slotX(previous: Rect | undefined, next: Rect | undefined): number {
	if (previous !== undefined && next !== undefined) {
		return (previous.x + previous.width + next.x) / 2;
	}
	if (next !== undefined) return next.x;
	if (previous !== undefined) return previous.x + previous.width;
	return 0;
}
