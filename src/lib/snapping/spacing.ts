// Equal-spacing guides, pure (#70). While a rectangle is dragged along a row (or column) of
// neighbours, snap it so that the gaps are equal: either it becomes equidistant between its two
// nearest neighbours, or the gap to a neighbour equals the gap of an existing pair in the row
// (docs/research/interactions.md section 5, [K] unverified). Each snap reports the gap brackets to
// draw, with the distance to label them with.
//
// The row of a horizontal snap is every rectangle whose vertical extent overlaps the moving
// rectangle's; a vertical snap is the same with the axes swapped.

import type { Rect } from '../document/types';
import { COINCIDENT, type Axis, type Point } from './snap';

/** A bracket along `axis` from `start` to `end`, drawn at `cross` on the other axis. */
export interface GapGuide {
	axis: Axis;
	start: number;
	end: number;
	cross: number;
	/** The gap in page units: `end - start`. */
	distance: number;
}

export interface SpacingOptions {
	/** Largest shift that still snaps, in page units. */
	threshold: number;
	axes?: 'both' | Axis;
}

export interface SpacingResult {
	delta: Point;
	gaps: GapGuide[];
	/** Axes on which a spacing snap is active (also when the shift is already zero). */
	snappedAxes: Axis[];
}

/** A rectangle seen along one axis: `start`/`end` on the main axis, the cross range beside it. */
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

function overlapsCross(first: Span, second: Span): boolean {
	return first.crossStart < second.crossEnd && second.crossStart < first.crossEnd;
}

/** Where a bracket between two spans sits on the cross axis: the middle of their shared range. */
function crossBetween(first: Span, second: Span): number {
	const start = Math.max(first.crossStart, second.crossStart);
	const end = Math.min(first.crossEnd, second.crossEnd);
	if (start < end) return (start + end) / 2;
	return (first.crossStart + first.crossEnd + second.crossStart + second.crossEnd) / 4;
}

interface Proposal {
	/** Where the moving span starts after the snap. */
	start: number;
	/** Brackets that explain it, with the moving span at `start`. */
	gaps: (movingStart: number, moving: Span) => GapGuide[];
}

function bracket(axis: Axis, start: number, end: number, first: Span, second: Span): GapGuide {
	return { axis, start, end, cross: crossBetween(first, second), distance: end - start };
}

function proposalsFor(moving: Span, row: Span[], axis: Axis): Proposal[] {
	const size = moving.end - moving.start;
	const centre = (moving.start + moving.end) / 2;
	let before: Span | undefined;
	let after: Span | undefined;
	for (const span of row) {
		const spanCentre = (span.start + span.end) / 2;
		if (spanCentre < centre && (before === undefined || span.end > before.end)) before = span;
		if (spanCentre >= centre && (after === undefined || span.start < after.start)) after = span;
	}
	const proposals: Proposal[] = [];
	if (before !== undefined && after !== undefined) {
		const free = after.start - before.end - size;
		if (free > COINCIDENT) proposals.push(between(axis, before, after, size, free));
	}
	for (const pair of adjacentPairs(row)) {
		const gap = pair.second.start - pair.first.end;
		if (before !== undefined) proposals.push(afterNeighbour(axis, pair, before, gap));
		if (after !== undefined) proposals.push(beforeNeighbour(axis, pair, after, gap, size));
	}
	return proposals;
}

function between(axis: Axis, before: Span, after: Span, size: number, free: number): Proposal {
	const start = before.end + free / 2;
	return {
		start,
		gaps: (movingStart, moving) => [
			bracket(axis, before.end, movingStart, before, moving),
			bracket(axis, movingStart + size, after.start, moving, after)
		]
	};
}

interface Pair {
	first: Span;
	second: Span;
}

function adjacentPairs(row: Span[]): Pair[] {
	const sorted = [...row].sort((first, second) => first.start - second.start);
	const pairs: Pair[] = [];
	for (let position = 0; position + 1 < sorted.length; position += 1) {
		const first = sorted[position];
		const second = sorted[position + 1];
		if (second.start - first.end > COINCIDENT) pairs.push({ first, second });
	}
	return pairs;
}

/** The moving rect sits right of `before`, separated by the same gap as `pair`. */
function afterNeighbour(axis: Axis, pair: Pair, before: Span, gap: number): Proposal {
	return {
		start: before.end + gap,
		gaps: (movingStart, moving) => [
			bracket(axis, pair.first.end, pair.second.start, pair.first, pair.second),
			bracket(axis, before.end, movingStart, before, moving)
		]
	};
}

/** The moving rect sits left of `after`, separated by the same gap as `pair`. */
function beforeNeighbour(axis: Axis, pair: Pair, after: Span, gap: number, size: number): Proposal {
	return {
		start: after.start - gap - size,
		gaps: (movingStart, moving) => [
			bracket(axis, pair.first.end, pair.second.start, pair.first, pair.second),
			bracket(axis, movingStart + size, after.start, moving, after)
		]
	};
}

function sameGap(first: GapGuide, second: GapGuide): boolean {
	return (
		Math.abs(first.start - second.start) < COINCIDENT &&
		Math.abs(first.end - second.end) < COINCIDENT &&
		Math.abs(first.cross - second.cross) < COINCIDENT
	);
}

function snapAxis(
	moving: Rect,
	others: readonly Rect[],
	axis: Axis,
	threshold: number
): { delta: number; gaps: GapGuide[] } | undefined {
	const movingSpan = spanOf(moving, axis);
	const row = others
		.map((rect) => spanOf(rect, axis))
		.filter((span) => overlapsCross(span, movingSpan));
	if (row.length === 0) return undefined;
	const candidates = proposalsFor(movingSpan, row, axis)
		.map((proposal) => ({ proposal, delta: proposal.start - movingSpan.start }))
		.filter((candidate) => Math.abs(candidate.delta) <= threshold);
	if (candidates.length === 0) return undefined;
	let best = candidates[0].delta;
	for (const candidate of candidates) {
		if (Math.abs(candidate.delta) < Math.abs(best)) best = candidate.delta;
		else if (Math.abs(candidate.delta) === Math.abs(best) && candidate.delta < best) {
			best = candidate.delta;
		}
	}
	const shifted = { ...movingSpan, start: movingSpan.start + best, end: movingSpan.end + best };
	const gaps: GapGuide[] = [];
	for (const candidate of candidates) {
		if (Math.abs(candidate.delta - best) >= COINCIDENT) continue;
		for (const gap of candidate.proposal.gaps(shifted.start, shifted)) {
			if (!gaps.some((known) => sameGap(known, gap))) gaps.push(gap);
		}
	}
	return { delta: best, gaps };
}

export function snapSpacing(
	moving: Rect,
	others: readonly Rect[],
	options: SpacingOptions
): SpacingResult {
	const axes = options.axes === undefined ? 'both' : options.axes;
	const delta = { x: 0, y: 0 };
	const gaps: GapGuide[] = [];
	const snappedAxes: Axis[] = [];
	for (const axis of ['x', 'y'] as const) {
		if (axes !== 'both' && axes !== axis) continue;
		const result = snapAxis(moving, others, axis, options.threshold);
		if (!result) continue;
		delta[axis] = result.delta;
		gaps.push(...result.gaps);
		snappedAxes.push(axis);
	}
	return { delta, gaps, snappedAxes };
}
