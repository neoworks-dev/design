// Inference for "add auto layout" (Shift+A): read direction, gap, padding and counter-axis
// alignment off where the children currently are, so the frame looks the same afterwards.
// Pure: rectangles in, settings out.

import type { Rect } from '../document/types';
import type { Size } from './types';

export interface InferredLayout {
	layoutMode: 'HORIZONTAL' | 'VERTICAL';
	itemSpacing: number;
	paddingTop: number;
	paddingRight: number;
	paddingBottom: number;
	paddingLeft: number;
	counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX';
}

const ALIGN_TOLERANCE = 0.5;

type Span = { start: number; end: number };

function spanOf(rect: Rect, axis: 'x' | 'y'): Span {
	if (axis === 'x') return { start: rect.x, end: rect.x + rect.width };
	return { start: rect.y, end: rect.y + rect.height };
}

/** How many separate bands the rectangles form along `axis` (overlapping spans share a band). */
export function countBands(rects: readonly Rect[], axis: 'x' | 'y'): number {
	const spans = rects.map((rect) => spanOf(rect, axis)).sort((a, b) => a.start - b.start);
	let bands = 0;
	let reach = -Infinity;
	for (const span of spans) {
		if (span.start >= reach) bands += 1;
		reach = Math.max(reach, span.end);
	}
	return bands;
}

/**
 * All in one row: horizontal. All in one column: vertical. A grid or any mix: the direction
 * with fewer bands across it (ties go horizontal). One child: the longer side of the container.
 */
export function inferDirection(rects: readonly Rect[], container: Size): 'HORIZONTAL' | 'VERTICAL' {
	if (rects.length <= 1) {
		if (container.height > container.width) return 'VERTICAL';
		return 'HORIZONTAL';
	}
	const rows = countBands(rects, 'y');
	const columns = countBands(rects, 'x');
	if (rows <= columns) return 'HORIZONTAL';
	return 'VERTICAL';
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle];
	return (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median of the gaps between neighbours along the stacking axis; overlaps count as no gap. */
export function inferSpacing(rects: readonly Rect[], mode: 'HORIZONTAL' | 'VERTICAL'): number {
	const axis = mode === 'HORIZONTAL' ? 'x' : 'y';
	const spans = rects.map((rect) => spanOf(rect, axis)).sort((a, b) => a.start - b.start);
	const gaps: number[] = [];
	for (let position = 1; position < spans.length; position += 1) {
		gaps.push(Math.max(0, spans[position].start - spans[position - 1].end));
	}
	return Math.round(median(gaps));
}

function counterAlignment(
	rects: readonly Rect[],
	mode: 'HORIZONTAL' | 'VERTICAL'
): 'MIN' | 'CENTER' | 'MAX' {
	const axis = mode === 'HORIZONTAL' ? 'y' : 'x';
	const spans = rects.map((rect) => spanOf(rect, axis));
	const same = (read: (span: Span) => number): boolean =>
		spans.every((span) => Math.abs(read(span) - read(spans[0])) <= ALIGN_TOLERANCE);
	if (same((span) => span.start)) return 'MIN';
	if (same((span) => (span.start + span.end) / 2)) return 'CENTER';
	if (same((span) => span.end)) return 'MAX';
	return 'MIN';
}

function nonNegative(value: number): number {
	return Math.max(0, Math.round(value));
}

/**
 * Settings that keep `rects` (positions relative to the container) where they are; `direction`
 * overrides the inferred one (the Flow buttons).
 */
export function inferLayout(
	rects: readonly Rect[],
	container: Size,
	direction?: 'HORIZONTAL' | 'VERTICAL'
): InferredLayout {
	const layoutMode = direction === undefined ? inferDirection(rects, container) : direction;
	if (rects.length === 0) {
		return {
			layoutMode,
			itemSpacing: 0,
			paddingTop: 0,
			paddingRight: 0,
			paddingBottom: 0,
			paddingLeft: 0,
			counterAxisAlignItems: 'MIN'
		};
	}
	const left = Math.min(...rects.map((rect) => rect.x));
	const top = Math.min(...rects.map((rect) => rect.y));
	const right = Math.max(...rects.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
	return {
		layoutMode,
		itemSpacing: inferSpacing(rects, layoutMode),
		paddingTop: nonNegative(top),
		paddingRight: nonNegative(container.width - right),
		paddingBottom: nonNegative(container.height - bottom),
		paddingLeft: nonNegative(left),
		counterAxisAlignItems: counterAlignment(rects, layoutMode)
	};
}
