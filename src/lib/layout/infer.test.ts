import { describe, expect, it } from 'vitest';
import type { Rect } from '../document';
import { countBands, inferDirection, inferLayout, inferSpacing } from './infer';

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

const ROW = [rect(10, 20, 40, 30), rect(60, 20, 40, 30), rect(115, 20, 40, 30)];
const COLUMN = [rect(20, 10, 30, 40), rect(20, 60, 30, 40), rect(20, 115, 30, 40)];
const GRID = [rect(0, 0, 50, 50), rect(60, 0, 50, 50), rect(0, 60, 50, 50), rect(60, 60, 50, 50)];

describe('direction', () => {
	it('is horizontal for a row, vertical for a column', () => {
		expect(inferDirection(ROW, { width: 165, height: 70 })).toBe('HORIZONTAL');
		expect(inferDirection(COLUMN, { width: 70, height: 165 })).toBe('VERTICAL');
	});

	it('picks the direction with fewer bands for mixed arrangements, ties horizontal', () => {
		expect(countBands(GRID, 'y')).toBe(2);
		expect(countBands(GRID, 'x')).toBe(2);
		expect(inferDirection(GRID, { width: 110, height: 110 })).toBe('HORIZONTAL');
		const threeColumnsTwoRows = [
			rect(0, 0, 20, 20),
			rect(30, 0, 20, 20),
			rect(60, 0, 20, 20),
			rect(0, 30, 20, 20)
		];
		expect(inferDirection(threeColumnsTwoRows, { width: 80, height: 50 })).toBe('HORIZONTAL');
		const tower = [
			rect(0, 0, 20, 20),
			rect(0, 30, 20, 20),
			rect(0, 60, 20, 20),
			rect(30, 0, 20, 20)
		];
		expect(inferDirection(tower, { width: 50, height: 80 })).toBe('VERTICAL');
	});

	it('follows the container for one child or none', () => {
		expect(inferDirection([rect(0, 0, 10, 10)], { width: 100, height: 40 })).toBe('HORIZONTAL');
		expect(inferDirection([rect(0, 0, 10, 10)], { width: 40, height: 100 })).toBe('VERTICAL');
		expect(inferDirection([], { width: 40, height: 100 })).toBe('VERTICAL');
	});
});

describe('spacing', () => {
	it('is the median gap, rounded', () => {
		expect(inferSpacing(ROW, 'HORIZONTAL')).toBe(13);
		const uneven = [
			rect(0, 0, 10, 10),
			rect(20, 0, 10, 10),
			rect(40, 0, 10, 10),
			rect(100, 0, 10, 10)
		];
		expect(inferSpacing(uneven, 'HORIZONTAL')).toBe(10);
	});

	it('ignores order of the input and treats overlap as no gap', () => {
		expect(inferSpacing([...ROW].reverse(), 'HORIZONTAL')).toBe(13);
		expect(inferSpacing([rect(0, 0, 50, 10), rect(30, 0, 50, 10)], 'HORIZONTAL')).toBe(0);
	});
});

describe('inferLayout', () => {
	it('reads padding off the distance from the children to the container edges', () => {
		const layout = inferLayout(ROW, { width: 175, height: 80 });
		expect(layout).toEqual({
			layoutMode: 'HORIZONTAL',
			itemSpacing: 13,
			paddingTop: 20,
			paddingRight: 20,
			paddingBottom: 30,
			paddingLeft: 10,
			counterAxisAlignItems: 'MIN'
		});
	});

	it('reads a column', () => {
		const layout = inferLayout(COLUMN, { width: 70, height: 165 });
		expect(layout).toMatchObject({
			layoutMode: 'VERTICAL',
			itemSpacing: 13,
			paddingTop: 10,
			paddingLeft: 20,
			paddingRight: 20,
			paddingBottom: 10
		});
	});

	it('detects centred and end-aligned counter axes', () => {
		const centred = [rect(0, 10, 40, 30), rect(50, 0, 40, 50), rect(100, 15, 40, 20)];
		expect(inferLayout(centred, { width: 140, height: 50 }).counterAxisAlignItems).toBe('CENTER');
		const ends = [rect(0, 20, 40, 30), rect(50, 0, 40, 50), rect(100, 10, 40, 40)];
		expect(inferLayout(ends, { width: 140, height: 50 }).counterAxisAlignItems).toBe('MAX');
		const ragged = [rect(0, 0, 40, 30), rect(50, 5, 40, 50), rect(100, 10, 40, 40)];
		expect(inferLayout(ragged, { width: 140, height: 60 }).counterAxisAlignItems).toBe('MIN');
	});

	it('never reports negative padding', () => {
		const layout = inferLayout([rect(-5, -5, 200, 200)], { width: 100, height: 100 });
		expect(layout).toMatchObject({
			paddingLeft: 0,
			paddingTop: 0,
			paddingRight: 0,
			paddingBottom: 0
		});
	});

	it('gives an empty container zero everything', () => {
		expect(inferLayout([], { width: 10, height: 10 })).toMatchObject({
			itemSpacing: 0,
			paddingTop: 0
		});
	});
});
