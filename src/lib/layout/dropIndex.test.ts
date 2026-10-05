import { describe, expect, it } from 'vitest';
import type { Rect } from '../document';
import { dropSlot, splitIntoLines } from './dropIndex';

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

const ROW = [rect(10, 10, 40, 30), rect(60, 10, 40, 30), rect(110, 10, 40, 30)];
const COLUMN = [rect(10, 10, 30, 40), rect(10, 60, 30, 40), rect(10, 110, 30, 40)];
const INNER = rect(10, 10, 140, 30);

function slotAt(x: number, y: number): ReturnType<typeof dropSlot> {
	return dropSlot({ mode: 'HORIZONTAL', wrap: false, rects: ROW, inner: INNER, point: { x, y } });
}

describe('horizontal stacks', () => {
	it('counts the children whose centre is left of the pointer', () => {
		expect(slotAt(0, 20).index).toBe(0);
		expect(slotAt(25, 20).index).toBe(0);
		expect(slotAt(35, 20).index).toBe(1);
		expect(slotAt(85, 20).index).toBe(2);
		expect(slotAt(500, 20).index).toBe(3);
	});

	it('draws the line in the middle of the gap, or at the ends', () => {
		expect(slotAt(55, 20).line).toEqual({ from: { x: 55, y: 10 }, to: { x: 55, y: 40 } });
		expect(slotAt(0, 20).line.from.x).toBe(10);
		expect(slotAt(500, 20).line.from.x).toBe(150);
	});

	it('puts an empty frame first with the line at the start of its content', () => {
		const slot = dropSlot({
			mode: 'HORIZONTAL',
			wrap: false,
			rects: [],
			inner: INNER,
			point: { x: 80, y: 20 }
		});
		expect(slot.index).toBe(0);
		expect(slot.line).toEqual({ from: { x: 10, y: 10 }, to: { x: 10, y: 40 } });
	});
});

describe('vertical stacks', () => {
	function slotAtY(y: number): ReturnType<typeof dropSlot> {
		return dropSlot({
			mode: 'VERTICAL',
			wrap: false,
			rects: COLUMN,
			inner: rect(10, 10, 30, 140),
			point: { x: 20, y }
		});
	}

	it('uses the vertical axis', () => {
		expect(slotAtY(0).index).toBe(0);
		expect(slotAtY(75).index).toBe(1);
		expect(slotAtY(130).index).toBe(2);
		expect(slotAtY(999).index).toBe(3);
	});

	it('draws a horizontal line in the gap', () => {
		expect(slotAtY(55).line).toEqual({ from: { x: 10, y: 55 }, to: { x: 40, y: 55 } });
	});
});

describe('wrapping stacks', () => {
	const wrapped = [
		rect(0, 0, 40, 20),
		rect(50, 0, 40, 20),
		rect(0, 30, 40, 20),
		rect(50, 30, 40, 20),
		rect(0, 60, 40, 20)
	];

	function wrapSlot(x: number, y: number): ReturnType<typeof dropSlot> {
		return dropSlot({
			mode: 'HORIZONTAL',
			wrap: true,
			rects: wrapped,
			inner: rect(0, 0, 90, 80),
			point: { x, y }
		});
	}

	it('splits the children into lines', () => {
		const lines = splitIntoLines(wrapped);
		expect(lines.map((line) => line.start)).toEqual([0, 2, 4]);
		expect(lines.map((line) => line.rects.length)).toEqual([2, 2, 1]);
	});

	it('picks the line under the pointer and counts within it', () => {
		expect(wrapSlot(70, 5).index).toBe(1);
		expect(wrapSlot(10, 35).index).toBe(2);
		expect(wrapSlot(80, 35).index).toBe(4);
		expect(wrapSlot(10, 65).index).toBe(4);
		expect(wrapSlot(90, 65).index).toBe(5);
	});

	it('picks the nearest line from the gap between lines and from outside', () => {
		expect(wrapSlot(10, 24).index).toBe(0);
		expect(wrapSlot(10, 27).index).toBe(2);
		expect(wrapSlot(10, 500).index).toBe(4);
		expect(wrapSlot(10, 70).line).toEqual({ from: { x: 0, y: 60 }, to: { x: 0, y: 80 } });
	});

	it('keeps the line to the height of the chosen line', () => {
		expect(wrapSlot(45, 35).line).toEqual({ from: { x: 45, y: 30 }, to: { x: 45, y: 50 } });
	});
});
