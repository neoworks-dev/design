import { describe, expect, it } from 'vitest';
import { transformPoint } from '../document/matrix';
import { parseColor } from './color';
import { parsePathData } from './pathData';
import { parseTransform } from './transform';

describe('parseColor', () => {
	it.each([
		['#f00', { r: 1, g: 0, b: 0, a: 1 }],
		['#00ff0080', { r: 0, g: 1, b: 0, a: 128 / 255 }],
		['rgb(255, 0, 0)', { r: 1, g: 0, b: 0, a: 1 }],
		['rgba(0, 0, 255, 0.5)', { r: 0, g: 0, b: 1, a: 0.5 }],
		['rgb(100% 0% 0%)', { r: 1, g: 0, b: 0, a: 1 }],
		['hsl(120, 100%, 50%)', { r: 0, g: 1, b: 0, a: 1 }],
		['teal', { r: 0, g: 128 / 255, b: 128 / 255, a: 1 }],
		['TRANSPARENT', { r: 0, g: 0, b: 0, a: 0 }]
	])('%s', (input, expected) => {
		const color = parseColor(input);
		expect(color).not.toBeNull();
		for (const key of ['r', 'g', 'b', 'a'] as const) {
			expect(color?.[key]).toBeCloseTo(expected[key], 6);
		}
	});

	it('rejects what it does not know', () => {
		expect(parseColor('url(#a)')).toBeNull();
		expect(parseColor('notacolor')).toBeNull();
		expect(parseColor('#12')).toBeNull();
	});
});

describe('parseTransform', () => {
	it('composes a list left to right', () => {
		const matrix = parseTransform('translate(10 20) scale(2)');
		expect(transformPoint(matrix, 1, 1)).toEqual({ x: 12, y: 22 });
	});

	it('rotates about a point', () => {
		const point = transformPoint(parseTransform('rotate(90 10 10)'), 20, 10);
		expect(point.x).toBeCloseTo(10, 9);
		expect(point.y).toBeCloseTo(20, 9);
	});

	it('reads matrix(), skews and falls back to identity for garbage', () => {
		expect(transformPoint(parseTransform('matrix(1 0 0 1 5 6)'), 0, 0)).toEqual({ x: 5, y: 6 });
		const skewed = transformPoint(parseTransform('skewX(45)'), 0, 2);
		expect(skewed.x).toBeCloseTo(2, 9);
		expect(transformPoint(parseTransform('wobble(3)'), 4, 5)).toEqual({ x: 4, y: 5 });
		expect(transformPoint(parseTransform(null), 4, 5)).toEqual({ x: 4, y: 5 });
	});
});

describe('parsePathData', () => {
	it('reads absolute and relative lines, H/V and close', () => {
		expect(parsePathData('M10 10 l 20 0 v 20 H 10 z')).toEqual([
			{ op: 'move', x: 10, y: 10 },
			{ op: 'line', x: 30, y: 10 },
			{ op: 'line', x: 30, y: 30 },
			{ op: 'line', x: 10, y: 30 },
			{ op: 'close' }
		]);
	});

	it('treats extra pairs after a move as lines and accepts compact numbers', () => {
		expect(parsePathData('M0,0 10,0 10-10.5')).toEqual([
			{ op: 'move', x: 0, y: 0 },
			{ op: 'line', x: 10, y: 0 },
			{ op: 'line', x: 10, y: -10.5 }
		]);
	});

	it('mirrors the control point for smooth cubics and quadratics', () => {
		const commands = parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
		expect(commands[2]).toEqual({ op: 'cubic', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 });
		const quadratic = parsePathData('M0 0 Q 5 10 10 0 T 20 0');
		expect(quadratic[2]).toMatchObject({ op: 'cubic', x: 20, y: 0 });
		expect((quadratic[2] as { y1: number }).y1).toBeCloseTo((-2 / 3) * 10, 9);
	});

	it('converts arcs to cubics that end on the endpoint and stay on the circle', () => {
		const commands = parsePathData('M10 0 A 10 10 0 0 1 -10 0');
		const cubics = commands.slice(1);
		expect(cubics.length).toBe(2);
		const last = cubics.at(-1);
		expect(last).toMatchObject({ op: 'cubic', x: -10, y: 0 });
		const middle = cubics[0];
		if (middle.op !== 'cubic') throw new Error('not a cubic');
		expect(Math.hypot(middle.x, middle.y)).toBeCloseTo(10, 6);
	});

	it('reads arc flags written without separators', () => {
		const commands = parsePathData('M0 0a5 5 0 1010 0');
		expect(commands.length).toBeGreaterThan(1);
		expect(commands.at(-1)).toMatchObject({ x: 10, y: 0 });
	});

	it('keeps what was parsed before a malformed command', () => {
		expect(parsePathData('M0 0 L 10 10 L oops')).toEqual([
			{ op: 'move', x: 0, y: 0 },
			{ op: 'line', x: 10, y: 10 }
		]);
		expect(parsePathData('')).toEqual([]);
		expect(parsePathData('L 1 1')).toEqual([]);
	});
});
