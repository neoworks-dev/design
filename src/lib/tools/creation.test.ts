import { describe, expect, it } from 'vitest';
import {
	boxPlacement,
	clickBounds,
	clickLine,
	dragBounds,
	dragLine,
	findContainer,
	linePlacement,
	nextName,
	snapAngle,
	type NestingSource
} from './creation';

const NONE = { altKey: false, shiftKey: false };
const ORIGIN = { x: 0, y: 0 };

describe('dragBounds', () => {
	it('spans the press and the pointer in any direction', () => {
		expect(dragBounds({ x: 50, y: 50 }, { x: 20, y: 90 }, NONE)).toEqual({
			x: 20,
			y: 50,
			width: 30,
			height: 40
		});
	});

	it('Shift makes a square on the longer side, keeping the drag direction', () => {
		expect(
			dragBounds({ x: 50, y: 50 }, { x: 20, y: 60 }, { altKey: false, shiftKey: true })
		).toEqual({ x: 20, y: 50, width: 30, height: 30 });
	});

	it('Alt draws from the centre', () => {
		expect(
			dragBounds({ x: 50, y: 50 }, { x: 60, y: 70 }, { altKey: true, shiftKey: false })
		).toEqual({ x: 40, y: 30, width: 20, height: 40 });
	});

	it('Alt and Shift together draw a centred square', () => {
		expect(dragBounds({ x: 0, y: 0 }, { x: 10, y: 30 }, { altKey: true, shiftKey: true })).toEqual({
			x: -30,
			y: -30,
			width: 60,
			height: 60
		});
	});
});

describe('click defaults', () => {
	it('a click makes a 100 x 100 box with the pointer at the top left', () => {
		expect(clickBounds({ x: 5, y: 7 })).toEqual({ x: 5, y: 7, width: 100, height: 100 });
	});

	it('a click makes a 100 long horizontal line', () => {
		expect(clickLine({ x: 5, y: 7 })).toEqual({ from: { x: 5, y: 7 }, to: { x: 105, y: 7 } });
	});
});

describe('lines', () => {
	it('Shift snaps the angle to 15 degree steps and keeps the length', () => {
		const snapped = snapAngle(ORIGIN, { x: 100, y: 30 }, 15);
		const angle = (Math.atan2(snapped.y, snapped.x) * 180) / Math.PI;
		expect(angle).toBeCloseTo(15, 6);
		expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 30), 6);
	});

	it('dragLine with Shift snaps, with Alt mirrors the start around the press', () => {
		const shifted = dragLine(ORIGIN, { x: 100, y: 3 }, { altKey: false, shiftKey: true });
		expect(shifted.to.y).toBeCloseTo(0, 6);
		const centred = dragLine({ x: 10, y: 10 }, { x: 20, y: 10 }, { altKey: true, shiftKey: false });
		expect(centred.from).toEqual({ x: 0, y: 10 });
	});

	it('linePlacement is a length x 0 node rotated towards the end', () => {
		const placement = linePlacement({ from: { x: 10, y: 10 }, to: { x: 10, y: 60 } }, [
			[1, 0, 0],
			[0, 1, 0]
		]);
		expect(placement.width).toBeCloseTo(50, 6);
		expect(placement.height).toBe(0);
		expect(placement.transform[0][2]).toBe(10);
		expect(placement.transform[1][0]).toBeCloseTo(1, 6);
	});
});

describe('placement in a parent', () => {
	it('expresses the world position in the parent space', () => {
		const placement = boxPlacement({ x: 150, y: 160, width: 20, height: 30 }, [
			[1, 0, 100],
			[0, 1, 100]
		]);
		expect(placement.transform).toEqual([
			[1, 0, 50],
			[0, 1, 60]
		]);
		expect([placement.width, placement.height]).toEqual([20, 30]);
	});
});

describe('nextName', () => {
	it('numbers one past the highest existing number', () => {
		expect(nextName('Rectangle', [])).toBe('Rectangle 1');
		expect(nextName('Rectangle', ['Rectangle 1', 'Rectangle 4', 'Ellipse 9', 'Rectangle'])).toBe(
			'Rectangle 5'
		);
	});
});

describe('findContainer', () => {
	const source: NestingSource = {
		children: (id) =>
			({ page: ['outer', 'other'], outer: ['inner'], inner: [], other: [] })[id] ?? [],
		describe: (id) => {
			if (id === 'inner') return { frameLike: true, visible: true, locked: false };
			if (id === 'other') return { frameLike: false, visible: true, locked: false };
			return { frameLike: true, visible: true, locked: false };
		},
		absoluteBounds: (id) => {
			if (id === 'inner') return { x: 20, y: 20, width: 20, height: 20 };
			if (id === 'outer') return { x: 0, y: 0, width: 100, height: 100 };
			return { x: 0, y: 0, width: 100, height: 100 };
		}
	};

	it('picks the deepest frame under the point, else the page', () => {
		expect(findContainer(source, 'page', { x: 25, y: 25 })).toBe('inner');
		expect(findContainer(source, 'page', { x: 80, y: 80 })).toBe('outer');
		expect(findContainer(source, 'page', { x: 500, y: 500 })).toBe('page');
	});

	it('skips locked and invisible frames', () => {
		const locked: NestingSource = {
			...source,
			describe: (id) => ({ frameLike: true, visible: true, locked: id !== 'page' })
		};
		expect(findContainer(locked, 'page', { x: 25, y: 25 })).toBe('page');
	});
});
