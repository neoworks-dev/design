import { describe, expect, it } from 'vitest';
import { frame, page } from '../document/fixtures';
import { at, box, storeOf } from './fixtures/editingFixture';
import {
	centringShift,
	intersection,
	pushRightOfSiblings,
	rectsIntersect,
	roundAwayFromZero,
	roundedFrom
} from './placement';

describe('placement arithmetic', () => {
	it('rounds halves away from zero', () => {
		expect(roundAwayFromZero(2.5)).toBe(3);
		expect(roundAwayFromZero(-2.5)).toBe(-3);
		expect(roundAwayFromZero(-2.4)).toBe(-2);
	});

	it('intersects strictly: touching rectangles do not overlap', () => {
		const left = { x: 0, y: 0, width: 10, height: 10 };
		expect(rectsIntersect(left, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
		expect(rectsIntersect(left, { x: 9.5, y: 0, width: 10, height: 10 })).toBe(true);
		expect(intersection(left, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
			x: 5,
			y: 5,
			width: 5,
			height: 5
		});
		expect(intersection(left, { x: 10, y: 0, width: 10, height: 10 })).toBeNull();
	});

	it('rounds the offset, not the target', () => {
		expect(roundedFrom({ x: 10, y: 20 }, { x: 14.4, y: 17.5 })).toEqual({ x: 14, y: 17 });
		expect(roundedFrom({ x: 10, y: 20 }, { x: 15.5, y: 20.2 })).toEqual({ x: 16, y: 20 });
	});

	it('centres whole pixels on the centre of an area', () => {
		const view = { x: 100, y: 100, width: 801, height: 600 };
		const content = { x: 0, y: 0, width: 100, height: 80 };
		expect(centringShift(view, content)).toEqual({ x: 451, y: 360 });
	});
});

describe('pushing right past siblings', () => {
	const store = storeOf([
		page(
			'P',
			[
				frame({ id: 'a', transform: at(0, 0), width: 100, height: 100 }),
				frame({ id: 'b', transform: at(140, 0), width: 50, height: 100 }),
				frame({ id: 'hidden', transform: at(230, 0), width: 50, height: 100, visible: false }),
				box('c', 0, 500)
			],
			{ id: 'p' }
		)
	]);

	it('moves to the right edge of the first collision plus 40, repeatedly, keeping y', () => {
		const rect = { x: 0, y: 0, width: 100, height: 100 };
		expect(pushRightOfSiblings(store, 'p', rect)).toEqual({ ...rect, x: 230 });
	});

	it('rounds the result to whole pixels', () => {
		const rect = { x: 0.4, y: -34.73, width: 100, height: 20 };
		expect(pushRightOfSiblings(store, 'p', rect)).toEqual({ ...rect, x: 0, y: -35 });
	});

	it('ignores hidden siblings and rectangles it does not touch', () => {
		const rect = { x: 230, y: 0, width: 100, height: 100 };
		expect(pushRightOfSiblings(store, 'p', rect)).toEqual(rect);
		const below = { x: 0, y: 200, width: 100, height: 100 };
		expect(pushRightOfSiblings(store, 'p', below)).toEqual(below);
	});
});
