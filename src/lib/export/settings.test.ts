import { describe, expect, it } from 'vitest';
import {
	fileNameFor,
	formatConstraint,
	parseConstraint,
	safeFileStem,
	scaleFor,
	suffixForConstraint,
	uniqueFileNames
} from './settings';

describe('export settings helpers', () => {
	it('derives the scale from SCALE, WIDTH and HEIGHT constraints', () => {
		const size = { width: 200, height: 100 };
		const base = { suffix: '', format: 'PNG' as const };
		expect(scaleFor({ ...base, constraint: { type: 'SCALE', value: 2 } }, size)).toBe(2);
		expect(scaleFor({ ...base, constraint: { type: 'WIDTH', value: 100 } }, size)).toBe(0.5);
		expect(scaleFor({ ...base, constraint: { type: 'HEIGHT', value: 300 } }, size)).toBe(3);
	});

	it('parses what the user types: 2x, 2, 512w, 256h; refuses out of range', () => {
		expect(parseConstraint('2x')).toEqual({ type: 'SCALE', value: 2 });
		expect(parseConstraint('1.5')).toEqual({ type: 'SCALE', value: 1.5 });
		expect(parseConstraint('512w')).toEqual({ type: 'WIDTH', value: 512 });
		expect(parseConstraint('256H')).toEqual({ type: 'HEIGHT', value: 256 });
		expect(parseConstraint('8x')).toBeNull();
		expect(parseConstraint('0.1x')).toBeNull();
		expect(parseConstraint('abc')).toBeNull();
	});

	it('formats constraints and suggests @2x suffixes', () => {
		expect(formatConstraint({ type: 'SCALE', value: 2 })).toBe('2x');
		expect(formatConstraint({ type: 'WIDTH', value: 64 })).toBe('64w');
		expect(suffixForConstraint({ type: 'SCALE', value: 1 })).toBe('');
		expect(suffixForConstraint({ type: 'SCALE', value: 3 })).toBe('@3x');
		expect(suffixForConstraint({ type: 'WIDTH', value: 3 })).toBe('');
	});

	it('builds safe, unique file names', () => {
		const setting = {
			suffix: '@2x',
			format: 'JPG' as const,
			constraint: { type: 'SCALE' as const, value: 2 }
		};
		expect(fileNameFor('Hero/Card: v2', setting)).toBe('Hero-Card- v2@2x.jpg');
		expect(safeFileStem('..')).toBe('Untitled');
		expect(uniqueFileNames(['A.png', 'a.png', 'A.png', 'B'])).toEqual([
			'A.png',
			'a (2).png',
			'A (3).png',
			'B'
		]);
	});
});
