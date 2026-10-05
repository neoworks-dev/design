import { describe, expect, it } from 'vitest';
import { MIN_LABEL_GAP_PIXELS, niceStep, rulerTicks } from './ticks';

describe('niceStep', () => {
	it.each([
		[1, 100],
		[0.5, 200],
		[0.1, 1000],
		[0.01, 10000],
		[2, 50],
		[8, 10],
		[256, 1]
	])('at scale %d labels every %d units', (scale, step) => {
		expect(niceStep(scale, MIN_LABEL_GAP_PIXELS)).toBe(step);
	});

	it('keeps labelled ticks at least the minimum gap apart at any zoom', () => {
		for (const scale of [0.01, 0.03, 0.2, 0.7, 1, 1.5, 3, 12, 64, 256]) {
			expect(niceStep(scale, MIN_LABEL_GAP_PIXELS) * scale).toBeGreaterThanOrEqual(
				MIN_LABEL_GAP_PIXELS
			);
		}
	});
});

describe('rulerTicks', () => {
	it('puts ticks on whole coordinates, labelled every major step', () => {
		const ticks = rulerTicks(-30, 230, 1);
		expect(ticks.every((tick) => Number.isInteger(tick.position))).toBe(true);
		const majors = ticks.filter((tick) => tick.major).map((tick) => tick.position);
		expect(majors).toEqual([0, 100, 200]);
		expect(ticks.length).toBeGreaterThan(majors.length);
	});

	it('adapts: zoomed out only coarse ticks, zoomed in unit ticks', () => {
		const far = rulerTicks(0, 100000, 0.01);
		expect(far.every((tick) => tick.position % 1000 === 0)).toBe(true);
		const near = rulerTicks(0, 20, 32);
		expect(near.length).toBe(21);
		expect(near.filter((tick) => tick.major).map((tick) => tick.position)).toEqual([
			0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
		]);
	});

	it('keeps ticks at least the minor gap apart on screen', () => {
		for (const scale of [0.05, 0.4, 1, 4, 20]) {
			const ticks = rulerTicks(0, 5000 / scale, scale);
			for (let index = 1; index < ticks.length; index += 1) {
				expect((ticks[index].position - ticks[index - 1].position) * scale).toBeGreaterThanOrEqual(
					5.99
				);
			}
		}
	});
});
