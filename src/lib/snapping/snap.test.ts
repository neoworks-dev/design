import { describe, expect, it } from 'vitest';
import type { Rect } from '../document/types';
import { ALL_LINES, lineOf, snapRect, type Axis, type LineKind } from './snap';

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

/** The definition, as nested loops: smallest |delta| (ties: the more negative) within threshold. */
function bruteForceDelta(
	moving: Rect,
	candidates: Rect[],
	axis: Axis,
	kinds: readonly LineKind[],
	threshold: number
): number | undefined {
	let best: number | undefined;
	for (const kind of kinds) {
		for (const candidate of candidates) {
			for (const candidateKind of ALL_LINES) {
				const delta = lineOf(candidate, axis, candidateKind) - lineOf(moving, axis, kind);
				if (Math.abs(delta) > threshold) continue;
				if (best === undefined) best = delta;
				else if (Math.abs(delta) < Math.abs(best)) best = delta;
				else if (Math.abs(delta) === Math.abs(best) && delta < best) best = delta;
			}
		}
	}
	return best;
}

/** Positions on `axis` where a moving line (after the shift) meets a candidate line. */
function bruteForceGuidePositions(
	shifted: Rect,
	candidates: Rect[],
	axis: Axis,
	kinds: readonly LineKind[]
): number[] {
	const positions: number[] = [];
	for (const kind of kinds) {
		const position = lineOf(shifted, axis, kind);
		const matched = candidates.some((candidate) =>
			ALL_LINES.some((other) => Math.abs(lineOf(candidate, axis, other) - position) < 1e-4)
		);
		if (matched && !positions.some((known) => Math.abs(known - position) < 1e-4)) {
			positions.push(position);
		}
	}
	return positions.sort((first, second) => first - second);
}

describe('snapRect', () => {
	it('snaps an edge to a nearby edge and reports a vertical guide with markers', () => {
		const target = rect(100, 0, 50, 50);
		const result = snapRect(rect(52, 200, 45, 30), [target], { threshold: 5 });
		// Right edge 97 is 3 from the target's left edge 100.
		expect(result.delta).toEqual({ x: 3, y: 0 });
		const guide = result.guides.find((entry) => entry.axis === 'x');
		expect(guide?.position).toBe(100);
		expect(guide?.start).toBe(0);
		expect(guide?.end).toBe(230);
		expect(guide?.markers).toEqual(
			expect.arrayContaining([
				{ x: 100, y: 0 },
				{ x: 100, y: 50 },
				{ x: 100, y: 200 },
				{ x: 100, y: 230 }
			])
		);
	});

	it('snaps centres and middles', () => {
		const target = rect(0, 0, 100, 100);
		const result = snapRect(rect(120, 120, 20, 20), [target], { threshold: 5, lines: {} });
		// Moving centre 130 is far from everything; nothing within 5.
		expect(result.delta).toEqual({ x: 0, y: 0 });
		const centred = snapRect(rect(41, 43, 20, 10), [target], { threshold: 5 });
		expect(centred.delta).toEqual({ x: -1, y: 2 });
	});

	it('picks the smallest shift and draws a guide for every coinciding line', () => {
		const first = rect(100, 0, 10, 10);
		const second = rect(100, 300, 40, 10);
		const result = snapRect(rect(96, 100, 30, 30), [first, second], {
			threshold: 8,
			lines: { x: ['min'] }
		});
		expect(result.delta.x).toBe(4);
		const guides = result.guides.filter((entry) => entry.axis === 'x');
		expect(guides).toHaveLength(1);
		expect(guides[0].start).toBe(0);
		expect(guides[0].end).toBe(310);
	});

	it('does not snap beyond the threshold and then draws no guides', () => {
		const result = snapRect(rect(0, 0, 10, 10), [rect(100, 100, 10, 10)], { threshold: 5 });
		expect(result).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
	});

	it('draws guides when already aligned (delta zero)', () => {
		const result = snapRect(rect(100, 300, 10, 10), [rect(100, 0, 50, 50)], { threshold: 5 });
		expect(result.delta).toEqual({ x: 0, y: 0 });
		expect(result.guides.map((guide) => guide.axis)).toEqual(['x']);
	});

	it('honours axes and the lines allowed to snap (resize drags one edge)', () => {
		const target = rect(100, 100, 50, 50);
		const xOnly = snapRect(rect(97, 97, 10, 10), [target], { threshold: 5, axes: 'x' });
		expect(xOnly.delta).toEqual({ x: -2, y: 0 });
		const rightEdge = snapRect(rect(60, 0, 37, 10), [target], {
			threshold: 5,
			lines: { x: ['max'], y: [] }
		});
		expect(rightEdge.delta).toEqual({ x: 3, y: 0 });
		const leftEdgeOnly = snapRect(rect(60, 0, 37, 10), [target], {
			threshold: 5,
			lines: { x: ['min'], y: [] }
		});
		expect(leftEdgeOnly.delta).toEqual({ x: 0, y: 0 });
	});

	it('matches a brute-force reference on random inputs (property test)', () => {
		const next = random(11);
		for (let round = 0; round < 400; round += 1) {
			const candidates: Rect[] = [];
			const count = Math.floor(next() * 12);
			for (let index = 0; index < count; index += 1) {
				candidates.push(
					rect(
						Math.round(next() * 40) * 5,
						Math.round(next() * 40) * 5,
						5 + Math.round(next() * 20) * 5,
						5 + Math.round(next() * 20) * 5
					)
				);
			}
			const moving = rect(next() * 200, next() * 200, 5 + next() * 60, 5 + next() * 60);
			const threshold = next() * 12;
			const kindsX: LineKind[] = round % 3 === 0 ? ['max'] : [...ALL_LINES];
			const result = snapRect(moving, candidates, { threshold, lines: { x: kindsX } });
			const expectedX = bruteForceDelta(moving, candidates, 'x', kindsX, threshold);
			const expectedY = bruteForceDelta(moving, candidates, 'y', ALL_LINES, threshold);
			expect(result.delta.x).toBeCloseTo(expectedX === undefined ? 0 : expectedX, 9);
			expect(result.delta.y).toBeCloseTo(expectedY === undefined ? 0 : expectedY, 9);
			const shifted = { ...moving, x: moving.x + result.delta.x, y: moving.y + result.delta.y };
			for (const axis of ['x', 'y'] as const) {
				const snapped = (axis === 'x' ? expectedX : expectedY) !== undefined;
				const kinds = axis === 'x' ? kindsX : ALL_LINES;
				let expectedPositions: number[] = [];
				if (snapped) expectedPositions = bruteForceGuidePositions(shifted, candidates, axis, kinds);
				const positions = result.guides
					.filter((guide) => guide.axis === axis)
					.map((guide) => guide.position)
					.sort((first, second) => first - second);
				expect(positions).toHaveLength(expectedPositions.length);
				positions.forEach((position, index) =>
					expect(position).toBeCloseTo(expectedPositions[index], 6)
				);
			}
		}
	});
});
