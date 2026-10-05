// Layout grids of a frame, pure (#73). A grid is a guide, not auto layout: COLUMNS and ROWS cut the
// frame into bands, GRID repeats square cells. All positions are in the frame's local space
// (origin at its top-left); callers map them to the page or the screen.
//
// Rules (docs/research/data-model.md section 5, `[K]` unverified):
//   STRETCH  `count` bands share the length left after the `offset` margin on both sides and the
//            gutters between bands.
//   MIN/MAX/CENTER  bands are `sectionSize` wide; the group of bands starts at `offset` from the
//            start (MIN), ends `offset` from the end (MAX) or is centred (CENTER).

import type { LayoutGrid, RGBA } from '../document/types';

export interface Track {
	start: number;
	end: number;
}

export const DEFAULT_GRID_COLOR: RGBA = { r: 1, g: 0, b: 0, a: 0.1 };
export const DEFAULT_COUNT = 5;
export const DEFAULT_GUTTER = 20;
export const DEFAULT_SECTION_SIZE = 10;
export const DEFAULT_BAND_SIZE = 64;

export function defaultGrid(pattern: LayoutGrid['pattern']): LayoutGrid {
	if (pattern === 'GRID') {
		return {
			pattern,
			visible: true,
			color: { ...DEFAULT_GRID_COLOR },
			sectionSize: DEFAULT_SECTION_SIZE
		};
	}
	return {
		pattern,
		visible: true,
		color: { ...DEFAULT_GRID_COLOR },
		alignment: 'STRETCH',
		count: DEFAULT_COUNT,
		gutterSize: DEFAULT_GUTTER,
		offset: 0,
		sectionSize: DEFAULT_BAND_SIZE
	};
}

function valueOr(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	return value;
}

/** The bands of a COLUMNS or ROWS grid along an axis of `length`. Empty for GRID. */
export function gridTracks(grid: LayoutGrid, length: number): Track[] {
	if (grid.pattern === 'GRID') return [];
	const count = Math.max(1, Math.floor(valueOr(grid.count, DEFAULT_COUNT)));
	const gutter = Math.max(0, valueOr(grid.gutterSize, DEFAULT_GUTTER));
	const offset = valueOr(grid.offset, 0);
	const alignment = grid.alignment === undefined ? 'STRETCH' : grid.alignment;
	let size = valueOr(grid.sectionSize, DEFAULT_BAND_SIZE);
	let origin = offset;
	if (alignment === 'STRETCH') {
		size = (length - 2 * offset - (count - 1) * gutter) / count;
	} else {
		const total = count * size + (count - 1) * gutter;
		if (alignment === 'MAX') origin = length - offset - total;
		if (alignment === 'CENTER') origin = (length - total) / 2;
	}
	if (size <= 0) return [];
	const tracks: Track[] = [];
	for (let index = 0; index < count; index += 1) {
		const start = origin + index * (size + gutter);
		tracks.push({ start, end: start + size });
	}
	return tracks;
}

/** The lines of a GRID pattern along an axis of `length`, from 0. Empty for other patterns. */
export function gridLines(grid: LayoutGrid, length: number): number[] {
	if (grid.pattern !== 'GRID') return [];
	const size = valueOr(grid.sectionSize, DEFAULT_SECTION_SIZE);
	if (size <= 0) return [];
	const lines: number[] = [];
	for (let position = 0; position <= length; position += size) lines.push(position);
	return lines;
}

export interface SnapPositions {
	/** Vertical lines (x positions). */
	x: number[];
	/** Horizontal lines (y positions). */
	y: number[];
}

/** Local positions objects snap to for the visible grids of a frame of `width` x `height`. */
export function snapPositions(
	grids: readonly LayoutGrid[],
	width: number,
	height: number
): SnapPositions {
	const positions: SnapPositions = { x: [], y: [] };
	for (const grid of grids) {
		if (!grid.visible) continue;
		if (grid.pattern === 'GRID') {
			positions.x.push(...gridLines(grid, width));
			positions.y.push(...gridLines(grid, height));
			continue;
		}
		const axis = grid.pattern === 'COLUMNS' ? positions.x : positions.y;
		const length = grid.pattern === 'COLUMNS' ? width : height;
		for (const track of gridTracks(grid, length)) axis.push(track.start, track.end);
	}
	return positions;
}

export function describeGrid(grid: LayoutGrid): string {
	if (grid.pattern === 'GRID') return 'Grid';
	if (grid.pattern === 'COLUMNS') return 'Columns';
	return 'Rows';
}
