import { describe, expect, it } from 'vitest';
import type { Rect } from '../document/types';
import { snapSpacing } from './spacing';

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

function random(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

describe('equal gaps between two neighbours', () => {
	const left = rect(0, 0, 50, 40);
	const right = rect(150, 0, 50, 40);

	it('snaps to the middle of the space and brackets both gaps', () => {
		// 100 of free space between 50 and 150, 20 wide: 40 on each side, so x = 90.
		const result = snapSpacing(rect(87, 5, 20, 30), [left, right], { threshold: 5 });
		expect(result.delta).toEqual({ x: 3, y: 0 });
		expect(result.snappedAxes).toEqual(['x']);
		expect(result.gaps).toHaveLength(2);
		expect(result.gaps.map((gap) => [gap.start, gap.end, gap.distance])).toEqual([
			[50, 90, 40],
			[110, 150, 40]
		]);
		for (const gap of result.gaps) expect(gap.cross).toBe(20);
	});

	it('does not snap when the gaps are unequal by more than the threshold', () => {
		const result = snapSpacing(rect(70, 5, 20, 30), [left, right], { threshold: 5 });
		expect(result.delta).toEqual({ x: 0, y: 0 });
		expect(result.gaps).toEqual([]);
		expect(result.snappedAxes).toEqual([]);
	});

	it('reports an already equal placement with a zero shift', () => {
		const result = snapSpacing(rect(90, 5, 20, 30), [left, right], { threshold: 5 });
		expect(result.delta.x).toBe(0);
		expect(result.gaps).toHaveLength(2);
		expect(result.snappedAxes).toEqual(['x']);
	});

	it('ignores rectangles that do not overlap the moving one on the other axis', () => {
		const result = snapSpacing(rect(87, 100, 20, 30), [left, right], { threshold: 5 });
		expect(result.snappedAxes).toEqual([]);
	});

	it('does not squeeze the rect into a space it does not fit', () => {
		const result = snapSpacing(rect(52, 5, 120, 30), [left, right], { threshold: 50 });
		expect(result.gaps).toEqual([]);
	});

	it('works vertically', () => {
		const top = rect(0, 0, 40, 50);
		const bottom = rect(0, 150, 40, 50);
		const result = snapSpacing(rect(5, 87, 30, 20), [top, bottom], { threshold: 5 });
		expect(result.delta).toEqual({ x: 0, y: 3 });
		expect(result.gaps.map((gap) => [gap.axis, gap.distance])).toEqual([
			['y', 40],
			['y', 40]
		]);
	});
});

describe('same gap as an existing pair', () => {
	const first = rect(0, 0, 50, 40);
	const second = rect(70, 0, 50, 40);

	it('snaps next to the last neighbour with the pair gap and brackets both', () => {
		// The pair is 20 apart; right of `second` (edge at 120) the next gap is 20: x = 140.
		const result = snapSpacing(rect(137, 5, 30, 30), [first, second], { threshold: 5 });
		expect(result.delta).toEqual({ x: 3, y: 0 });
		expect(result.gaps.map((gap) => [gap.start, gap.end, gap.distance])).toEqual([
			[50, 70, 20],
			[120, 140, 20]
		]);
	});

	it('snaps on the left side of the first neighbour too', () => {
		const result = snapSpacing(rect(-52, 5, 30, 30), [first, second], { threshold: 5 });
		// Left of `first`: right edge at 0 - 20 = -20, so x = -50.
		expect(result.delta.x).toBe(2);
		expect(result.gaps.map((gap) => gap.distance)).toEqual([20, 20]);
	});

	it('does not snap to a pair gap further away than the threshold', () => {
		const result = snapSpacing(rect(150, 5, 30, 30), [first, second], { threshold: 5 });
		expect(result.snappedAxes).toEqual([]);
	});
});

describe('invariants on random rows (property test)', () => {
	it('snapped gaps are equal, touch real edges and the shift stays within the threshold', () => {
		const next = random(5);
		let snaps = 0;
		for (let round = 0; round < 500; round += 1) {
			const others: Rect[] = [];
			const count = 2 + Math.floor(next() * 5);
			for (let index = 0; index < count; index += 1) {
				others.push(rect(Math.round(next() * 40) * 10, 0, 10 + Math.round(next() * 6) * 10, 40));
			}
			const moving = rect(Math.round(next() * 400), 5, 10 + Math.round(next() * 5) * 10, 30);
			const threshold = next() * 10;
			const result = snapSpacing(moving, others, { threshold, axes: 'x' });
			if (result.snappedAxes.length === 0) continue;
			snaps += 1;
			expect(Math.abs(result.delta.x)).toBeLessThanOrEqual(threshold + 1e-9);
			expect(result.gaps.length).toBeGreaterThanOrEqual(1);
			const distances = result.gaps.map((gap) => gap.distance);
			// Every proposal explains itself with equal gaps: all distances of one snap match.
			for (const distance of distances) expect(distance).toBeCloseTo(distances[0], 6);
			const shifted = moving.x + result.delta.x;
			const edges = [
				...others.flatMap((other) => [other.x, other.x + other.width]),
				shifted,
				shifted + moving.width
			];
			for (const gap of result.gaps) {
				expect(edges.some((edge) => Math.abs(edge - gap.start) < 1e-6)).toBe(true);
				expect(edges.some((edge) => Math.abs(edge - gap.end) < 1e-6)).toBe(true);
				expect(gap.distance).toBeGreaterThan(0);
			}
		}
		expect(snaps).toBeGreaterThan(20);
	});
});
