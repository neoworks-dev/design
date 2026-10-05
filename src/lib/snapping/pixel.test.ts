import { describe, expect, it } from 'vitest';
import { pixelDelta, pixelShift } from './pixel';

const FRACTIONAL = { x: 10.4, y: 20.6, width: 30.3, height: 40.2 };

describe('pixelDelta', () => {
	it('moves the origin of a rectangle onto whole coordinates', () => {
		const delta = pixelDelta(FRACTIONAL);
		expect(delta.x).toBeCloseTo(-0.4, 9);
		expect(delta.y).toBeCloseTo(0.4, 9);
	});

	it('is zero for a rectangle that is already whole', () => {
		expect(pixelDelta({ x: 5, y: -7, width: 3.3, height: 9 })).toEqual({ x: 0, y: 0 });
	});

	it('rounds negative coordinates to the nearest whole pixel', () => {
		expect(pixelShift({ x: -3.2, y: 0, width: 1, height: 1 }, 'x')).toBeCloseTo(0.2, 9);
	});

	it('rounds only the dragged edge of a resize', () => {
		const east = pixelDelta(FRACTIONAL, { lines: { x: ['max'] } });
		expect(east.x).toBeCloseTo(Math.round(40.7) - 40.7, 9);
		expect(east.y).toBe(0);
		const north = pixelDelta(FRACTIONAL, { lines: { y: ['min'] } });
		expect(north.x).toBe(0);
		expect(north.y).toBeCloseTo(0.4, 9);
	});

	it('does nothing for a centre line, or an axis the caller excludes', () => {
		expect(pixelDelta(FRACTIONAL, { lines: { x: ['center'] } }).x).toBe(0);
		expect(pixelShift(FRACTIONAL, 'x', { axes: 'y' })).toBe(0);
	});
});
