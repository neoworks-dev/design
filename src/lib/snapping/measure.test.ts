import { describe, expect, it } from 'vitest';
import type { Rect } from '../document/types';
import { worldToScreen, type Camera } from '../viewport/camera';
import { formatDistance, measureBetween, projectMeasurement } from './measure';

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

describe('measureBetween', () => {
	it('gives one line across a horizontal gap, centred on the shared vertical range', () => {
		const lines = measureBetween(rect(0, 0, 50, 50), rect(120, 20, 40, 60));
		const horizontal = lines.filter((line) => line.axis === 'x');
		expect(horizontal).toEqual([{ axis: 'x', start: 50, end: 120, cross: 35, distance: 70 }]);
	});

	it('gives the four insets when the target contains the selection', () => {
		const lines = measureBetween(rect(20, 30, 40, 10), rect(0, 0, 100, 100));
		expect(lines.map((line) => `${line.axis}${line.distance}`).sort()).toEqual([
			'x20',
			'x40',
			'y30',
			'y60'
		]);
	});

	it('gives the four insets when the selection contains the target', () => {
		const lines = measureBetween(rect(0, 0, 100, 100), rect(20, 30, 40, 10));
		expect(lines.map((line) => line.distance).sort((a, b) => a - b)).toEqual([20, 30, 40, 60]);
	});

	it('joins matching edges when the rects partly overlap and drops zero distances', () => {
		const lines = measureBetween(rect(0, 0, 100, 50), rect(60, 0, 100, 50));
		// x: left edges 60 apart, right edges 60 apart; y: aligned on both edges, no lines.
		expect(lines.filter((line) => line.axis === 'y')).toEqual([]);
		expect(lines.filter((line) => line.axis === 'x').map((line) => line.distance)).toEqual([
			60, 60
		]);
	});

	it('adds a dashed extension when the rects do not overlap on the other axis', () => {
		const lines = measureBetween(rect(0, 0, 50, 50), rect(100, 200, 40, 40));
		const horizontal = lines.find((line) => line.axis === 'x');
		expect(horizontal).toEqual({
			axis: 'x',
			start: 50,
			end: 100,
			cross: 25,
			distance: 50,
			extension: { at: 100, to: 200 }
		});
		const vertical = lines.find((line) => line.axis === 'y');
		expect(vertical?.distance).toBe(150);
		expect(vertical?.extension).toEqual({ at: 200, to: 100 });
	});

	it('reports nothing for identical rects', () => {
		expect(measureBetween(rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toEqual([]);
	});
});

describe('formatDistance', () => {
	it('prints whole numbers plainly and others with one decimal', () => {
		expect(formatDistance(70)).toBe('70');
		expect(formatDistance(12.34)).toBe('12.3');
		expect(formatDistance(0.04)).toBe('0');
	});
});

describe('projectMeasurement at different zooms', () => {
	const lines = measureBetween(rect(0, 0, 50, 50), rect(150, 10, 40, 30));

	function project(scale: number, x: number, y: number): ReturnType<typeof projectMeasurement> {
		const camera: Camera = { x, y, scale };
		return projectMeasurement(lines, (point) => worldToScreen(camera, point));
	}

	it('keeps the label at the page distance while the screen length follows the zoom', () => {
		for (const scale of [0.5, 1, 4]) {
			const [horizontal] = project(scale, 30, -20);
			expect(horizontal.label).toBe('100');
			expect(horizontal.to.x - horizontal.from.x).toBeCloseTo(100 * scale, 9);
			expect(horizontal.from.y).toBeCloseTo(horizontal.to.y, 9);
		}
	});

	it('places lines where the camera maps the page points', () => {
		const [horizontal] = project(4, 30, -20);
		// Gap from x 50 to 150 at y 25 (middle of the shared range 10..40 is 25).
		expect(horizontal.from).toEqual({ x: 50 * 4 + 30, y: 25 * 4 - 20 });
		expect(horizontal.to).toEqual({ x: 150 * 4 + 30, y: 25 * 4 - 20 });
		expect(horizontal.labelAt).toEqual({ x: 100 * 4 + 30, y: 25 * 4 - 20 });
	});
});
