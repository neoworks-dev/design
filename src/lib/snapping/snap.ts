// Object snapping, pure (#69). Given the rectangle being moved or resized and the rectangles it can
// snap to (all in page space), find the per-axis shift that aligns an edge or centre of the moving
// rectangle with an edge or centre of a candidate, and the guides to draw for it.
//
// Algorithm (docs/research/interactions.md section 5, [K] unverified): collect the candidate lines
// (x: left, centre, right; y: top, middle, bottom), take for each moving line the nearest candidate
// line (binary search over the sorted lines), keep the smallest |delta| per axis, apply it when
// within the threshold, then report a guide for every candidate line that coincides with a moving
// line after the shift, not only the winning one.

import type { Rect } from '../document/types';

export type Axis = 'x' | 'y';
export type LineKind = 'min' | 'center' | 'max';

export interface Point {
	x: number;
	y: number;
}

export interface SnapOptions {
	/** Largest shift that still snaps, in page units (screen pixels divided by the zoom). */
	threshold: number;
	/** Which axes may snap. Default both. */
	axes?: 'both' | Axis;
	/**
	 * Which lines of the moving rectangle take part, per axis. Default all three on both axes.
	 * A resize passes only the edges being dragged.
	 */
	lines?: { x?: readonly LineKind[]; y?: readonly LineKind[] };
}

/** A line to draw: `position` on `axis` (an x guide is vertical), spanning `start` to `end`. */
export interface SnapGuide {
	axis: Axis;
	position: number;
	start: number;
	end: number;
	/** Where the line touches an aligned edge or centre: the small x marks. */
	markers: Point[];
}

export interface SnapResult {
	delta: Point;
	guides: SnapGuide[];
}

export const ALL_LINES: readonly LineKind[] = ['min', 'center', 'max'];

/** Two lines closer than this count as the same line. */
export const COINCIDENT = 1e-4;

export function lineOf(rect: Rect, axis: Axis, kind: LineKind): number {
	const origin = axis === 'x' ? rect.x : rect.y;
	const size = axis === 'x' ? rect.width : rect.height;
	if (kind === 'min') return origin;
	if (kind === 'center') return origin + size / 2;
	return origin + size;
}

function crossRange(rect: Rect, axis: Axis): { start: number; end: number } {
	if (axis === 'x') return { start: rect.y, end: rect.y + rect.height };
	return { start: rect.x, end: rect.x + rect.width };
}

interface CandidateLine {
	position: number;
	rect: Rect;
	kind: LineKind;
}

function sortedCandidateLines(candidates: readonly Rect[], axis: Axis): CandidateLine[] {
	const lines: CandidateLine[] = [];
	for (const rect of candidates) {
		for (const kind of ALL_LINES) lines.push({ position: lineOf(rect, axis, kind), rect, kind });
	}
	return lines.sort((first, second) => first.position - second.position);
}

/** Index of the first line at or after `position`. */
function lowerBound(lines: readonly CandidateLine[], position: number): number {
	let low = 0;
	let high = lines.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (lines[middle].position < position) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** Prefers the smaller shift; on a tie the more negative one, so results are deterministic. */
function isBetter(delta: number, best: number | undefined): boolean {
	if (best === undefined) return true;
	const magnitude = Math.abs(delta);
	const bestMagnitude = Math.abs(best);
	if (magnitude !== bestMagnitude) return magnitude < bestMagnitude;
	return delta < best;
}

function bestDelta(
	moving: Rect,
	kinds: readonly LineKind[],
	lines: readonly CandidateLine[],
	axis: Axis,
	threshold: number
): number | undefined {
	let best: number | undefined;
	for (const kind of kinds) {
		const position = lineOf(moving, axis, kind);
		const after = lowerBound(lines, position);
		for (const neighbour of [after - 1, after]) {
			if (neighbour < 0 || neighbour >= lines.length) continue;
			const delta = lines[neighbour].position - position;
			if (Math.abs(delta) > threshold) continue;
			if (isBetter(delta, best)) best = delta;
		}
	}
	return best;
}

function guidesFor(
	shifted: Rect,
	kinds: readonly LineKind[],
	lines: readonly CandidateLine[],
	axis: Axis
): SnapGuide[] {
	const guides: SnapGuide[] = [];
	const crossAxis: Axis = axis === 'x' ? 'y' : 'x';
	for (const kind of kinds) {
		const position = lineOf(shifted, axis, kind);
		const matches = lines.filter((line) => Math.abs(line.position - position) < COINCIDENT);
		if (matches.length === 0) continue;
		if (guides.some((guide) => Math.abs(guide.position - position) < COINCIDENT)) {
			addMarkers(guides, position, shifted, kind, matches, axis, crossAxis);
			continue;
		}
		guides.push({ axis, position, start: Infinity, end: -Infinity, markers: [] });
		addMarkers(guides, position, shifted, kind, matches, axis, crossAxis);
	}
	return guides;
}

function marker(axis: Axis, position: number, cross: number): Point {
	if (axis === 'x') return { x: position, y: cross };
	return { x: cross, y: position };
}

function addMarkers(
	guides: SnapGuide[],
	position: number,
	shifted: Rect,
	kind: LineKind,
	matches: readonly CandidateLine[],
	axis: Axis,
	crossAxis: Axis
): void {
	const guide = guides.find((entry) => Math.abs(entry.position - position) < COINCIDENT);
	if (!guide) return;
	const participants: { rect: Rect; kind: LineKind }[] = [{ rect: shifted, kind }];
	for (const match of matches) participants.push({ rect: match.rect, kind: match.kind });
	for (const participant of participants) {
		const range = crossRange(participant.rect, axis);
		guide.start = Math.min(guide.start, range.start);
		guide.end = Math.max(guide.end, range.end);
		const cross = lineOf(participant.rect, crossAxis, 'center');
		if (participant.kind === 'center') {
			guide.markers.push(marker(axis, position, cross));
			continue;
		}
		guide.markers.push(marker(axis, position, range.start), marker(axis, position, range.end));
	}
}

function dedupe(points: Point[]): Point[] {
	const result: Point[] = [];
	for (const point of points) {
		const known = result.some(
			(other) =>
				Math.abs(other.x - point.x) < COINCIDENT && Math.abs(other.y - point.y) < COINCIDENT
		);
		if (!known) result.push(point);
	}
	return result;
}

function snapAxis(
	moving: Rect,
	candidates: readonly Rect[],
	axis: Axis,
	kinds: readonly LineKind[],
	threshold: number
): number | undefined {
	if (kinds.length === 0 || candidates.length === 0) return undefined;
	return bestDelta(moving, kinds, sortedCandidateLines(candidates, axis), axis, threshold);
}

export function snapRect(
	moving: Rect,
	candidates: readonly Rect[],
	options: SnapOptions
): SnapResult {
	const axes = options.axes === undefined ? 'both' : options.axes;
	const xKinds = options.lines?.x === undefined ? ALL_LINES : options.lines.x;
	const yKinds = options.lines?.y === undefined ? ALL_LINES : options.lines.y;
	const useX = axes === 'both' || axes === 'x';
	const useY = axes === 'both' || axes === 'y';
	const snapX = useX ? snapAxis(moving, candidates, 'x', xKinds, options.threshold) : undefined;
	const snapY = useY ? snapAxis(moving, candidates, 'y', yKinds, options.threshold) : undefined;
	const delta = { x: snapX === undefined ? 0 : snapX, y: snapY === undefined ? 0 : snapY };
	const shifted = { ...moving, x: moving.x + delta.x, y: moving.y + delta.y };
	const guides: SnapGuide[] = [];
	if (snapX !== undefined) {
		guides.push(...guidesFor(shifted, xKinds, sortedCandidateLines(candidates, 'x'), 'x'));
	}
	if (snapY !== undefined) {
		guides.push(...guidesFor(shifted, yKinds, sortedCandidateLines(candidates, 'y'), 'y'));
	}
	for (const guide of guides) guide.markers = dedupe(guide.markers);
	return { delta, guides };
}
