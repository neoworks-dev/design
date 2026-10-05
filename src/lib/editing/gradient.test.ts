import { describe, expect, it } from 'vitest';
import type { ColorStop, GradientPaint } from '../document/types';
import {
	addStop,
	colorAt,
	defaultGradientTransform,
	handlePoints,
	moveHandle,
	moveStop,
	positionAlongAxis,
	removeStop,
	reverseStops,
	rotateGradient
} from './gradient';

function stop(position: number, r: number): ColorStop {
	return { position, color: { r, g: 0, b: 0, a: 1 } };
}

function paint(type: GradientPaint['type']): GradientPaint {
	return {
		type,
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		gradientTransform: defaultGradientTransform(),
		gradientStops: [stop(0, 0), stop(1, 1)]
	};
}

function near(actual: number, expected: number): void {
	expect(Math.abs(actual - expected)).toBeLessThan(1e-9);
}

describe('gradient handles', () => {
	it('default linear handles run left to right through the middle', () => {
		const points = handlePoints(paint('GRADIENT_LINEAR'));
		expect(points.origin).toEqual({ x: 0, y: 0.5 });
		expect(points.end).toEqual({ x: 1, y: 0.5 });
	});

	it('default radial handles are the centre and the right edge', () => {
		const points = handlePoints(paint('GRADIENT_RADIAL'));
		expect(points.origin).toEqual({ x: 0.5, y: 0.5 });
		expect(points.end).toEqual({ x: 1, y: 0.5 });
	});

	it('moving the end handle of a linear gradient leaves the start in place', () => {
		const moved = moveHandle(paint('GRADIENT_LINEAR'), 'end', { x: 0.5, y: 1 });
		const points = handlePoints(moved);
		near(points.origin.x, 0);
		near(points.origin.y, 0.5);
		near(points.end.x, 0.5);
		near(points.end.y, 1);
	});

	it('moving the centre of a radial gradient moves the whole gradient', () => {
		const moved = moveHandle(paint('GRADIENT_RADIAL'), 'origin', { x: 0.25, y: 0.25 });
		const points = handlePoints(moved);
		near(points.origin.x, 0.25);
		near(points.end.x, 0.75);
		near(points.end.y, 0.25);
	});

	it('round-trips through the stored transform for every type', () => {
		for (const type of [
			'GRADIENT_LINEAR',
			'GRADIENT_RADIAL',
			'GRADIENT_ANGULAR',
			'GRADIENT_DIAMOND'
		] as const) {
			const moved = moveHandle(paint(type), 'width', { x: 0.3, y: 0.9 });
			const points = handlePoints(moved);
			near(points.width.x, 0.3);
			near(points.width.y, 0.9);
		}
	});

	it('rotates a quarter turn about the centre', () => {
		const rotated = rotateGradient(paint('GRADIENT_RADIAL'), { width: 100, height: 100 });
		const points = handlePoints(rotated);
		near(points.origin.x, 0.5);
		near(points.end.x, 0.5);
		near(points.end.y, 1);
	});

	it('reads the stop position along the axis', () => {
		near(positionAlongAxis(paint('GRADIENT_LINEAR'), { x: 0.25, y: 0.9 }), 0.25);
	});
});

describe('stops', () => {
	it('interpolates colours and adds a stop with the colour already there', () => {
		const stops = [stop(0, 0), stop(1, 1)];
		near(colorAt(stops, 0.25).r, 0.25);
		const added = addStop(stops, 0.5);
		expect(added.index).toBe(1);
		near(added.stops[1].color.r, 0.5);
	});

	it('keeps at least two stops', () => {
		expect(removeStop([stop(0, 0), stop(1, 1)], 0)).toHaveLength(2);
		expect(removeStop([stop(0, 0), stop(0.5, 0.5), stop(1, 1)], 1)).toHaveLength(2);
	});

	it('clamps a moved stop between its neighbours', () => {
		const stops = [stop(0, 0), stop(0.5, 0.5), stop(1, 1)];
		expect(moveStop(stops, 1, 2)[1].position).toBe(1);
		expect(moveStop(stops, 1, -1)[1].position).toBe(0);
	});

	it('reverses mirrored positions in ascending order', () => {
		const reversed = reverseStops([stop(0, 0), stop(0.25, 0.5), stop(1, 1)]);
		expect(reversed.map((entry) => entry.position)).toEqual([0, 0.75, 1]);
		expect(reversed[0].color.r).toBe(1);
	});
});
