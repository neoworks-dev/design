import { describe, expect, it } from 'vitest';
import { defaultGrid, gridLines, gridTracks, snapPositions } from './grids';

describe('layout grid tracks', () => {
	it('stretches columns over the length minus margins and gutters', () => {
		const grid = { ...defaultGrid('COLUMNS'), count: 4, gutterSize: 20, offset: 10 };
		const tracks = gridTracks(grid, 360);
		expect(tracks).toHaveLength(4);
		expect(tracks[0]).toEqual({ start: 10, end: 80 });
		expect(tracks[3]).toEqual({ start: 280, end: 350 });
	});

	it('places fixed width columns by alignment', () => {
		const base = {
			...defaultGrid('COLUMNS'),
			count: 2,
			gutterSize: 10,
			sectionSize: 40,
			offset: 5
		};
		expect(gridTracks({ ...base, alignment: 'MIN' }, 200)[0].start).toBe(5);
		const max = gridTracks({ ...base, alignment: 'MAX' }, 200);
		expect(max[1].end).toBe(195);
		const center = gridTracks({ ...base, alignment: 'CENTER' }, 200);
		expect(center[0].start).toBe(55);
		expect(center[1].end).toBe(145);
	});

	it('uses the vertical length for rows', () => {
		const grid = { ...defaultGrid('ROWS'), count: 2, gutterSize: 0, offset: 0 };
		expect(gridTracks(grid, 100)).toEqual([
			{ start: 0, end: 50 },
			{ start: 50, end: 100 }
		]);
	});

	it('has no tracks when the margins leave no room', () => {
		const grid = { ...defaultGrid('COLUMNS'), count: 3, gutterSize: 100, offset: 0 };
		expect(gridTracks(grid, 100)).toEqual([]);
	});

	it('lines up a square grid from the origin', () => {
		const grid = { ...defaultGrid('GRID'), sectionSize: 25 };
		expect(gridLines(grid, 100)).toEqual([0, 25, 50, 75, 100]);
	});
});

describe('snap positions', () => {
	it('lists band edges and grid lines of visible grids only', () => {
		const columns = { ...defaultGrid('COLUMNS'), count: 2, gutterSize: 0, offset: 0 };
		const hidden = { ...defaultGrid('GRID'), visible: false };
		const positions = snapPositions([columns, hidden], 100, 60);
		expect(positions.x).toEqual([0, 50, 50, 100]);
		expect(positions.y).toEqual([]);
	});
});
