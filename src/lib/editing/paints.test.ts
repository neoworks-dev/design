import { describe, expect, it } from 'vitest';
import {
	convertPaint,
	newPaint,
	removeAt,
	reorder,
	withBoundColor,
	withSolidColor
} from './paints';

describe('convertPaint', () => {
	it('turns a solid into a gradient that fades the same colour out', () => {
		const solid = { ...newPaint('stroke'), color: { r: 1, g: 0, b: 0 }, opacity: 0.5 };
		const gradient = convertPaint(solid, 'GRADIENT_RADIAL');
		if (gradient.type !== 'GRADIENT_RADIAL') throw new Error('not a radial gradient');
		expect(gradient.opacity).toBe(0.5);
		expect(gradient.gradientStops.map((stop) => stop.color.a)).toEqual([1, 0]);
		expect(gradient.gradientStops[0].color.r).toBe(1);
	});

	it('keeps stops and transform between gradient types and takes the first stop for solid', () => {
		const linear = convertPaint(newPaint('fill'), 'GRADIENT_LINEAR');
		const angular = convertPaint(linear, 'GRADIENT_ANGULAR');
		if (linear.type === 'SOLID' || linear.type === 'IMAGE') throw new Error('not a gradient');
		if (angular.type === 'SOLID' || angular.type === 'IMAGE') throw new Error('not a gradient');
		expect(angular.gradientStops).toBe(linear.gradientStops);
		const solid = convertPaint(angular, 'SOLID');
		expect(solid).toMatchObject({ type: 'SOLID', color: { r: 0.85 } });
	});
});

describe('list operations', () => {
	it('reorders and removes', () => {
		expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
		expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
		expect(reorder(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
		expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
	});
});

describe('colour edits', () => {
	it('moves the picker alpha into the paint opacity and drops a binding', () => {
		const bound = withBoundColor(newPaint('fill'), 'v1');
		expect(bound.boundVariables).toEqual({ color: { type: 'VARIABLE_ALIAS', id: 'v1' } });
		const edited = withSolidColor(bound, { r: 0.1, g: 0.2, b: 0.3, a: 0.4 });
		expect(edited.boundVariables).toBeUndefined();
		expect(edited).toMatchObject({ color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.4 });
		expect(withBoundColor(bound, null).boundVariables).toBeUndefined();
	});
});
