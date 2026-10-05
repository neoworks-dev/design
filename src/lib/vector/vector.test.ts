import { describe, expect, it } from 'vitest';
import { createNode } from '../document/defaults';
import { parseNode } from '../document/schema';
import type { VectorNetwork } from '../document/types';
import { expandCornerRadii } from './cornerRadius';
import { fitFreehand } from './fit';
import {
	cubicPoint,
	networkBounds,
	networkSignedDistance,
	normalizeNetwork,
	regionAt,
	segmentControls
} from './geometry';
import {
	bendSegment,
	bendVertex,
	dragHandle,
	hasHandles,
	mirroredTangent,
	removeHandles,
	setMirroring
} from './handles';
import {
	deleteVertices,
	healVertices,
	isEndpoint,
	joinVertices,
	moveVertices,
	paintRegion,
	segmentsAt
} from './network';
import { PenSession } from './penSession';

function isValidVector(network: VectorNetwork | null): boolean {
	if (!network) return false;
	return parseNode(createNode('VECTOR', { network, parentId: 'p', index: 'a0' })).ok;
}

function polyline(...points: [number, number][]): VectorNetwork {
	return {
		vertices: points.map(([x, y]) => ({ x, y })),
		segments: points.slice(1).map((_, index) => ({ start: index, end: index + 1 }))
	};
}

describe('pen session', () => {
	it('click makes corner points and Enter-style finish returns an open network', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		session.release();
		session.press({ x: 50, y: 0 }, 4, false);
		session.release();
		session.press({ x: 50, y: 50 }, 4, false);
		session.release();
		const network = session.finish();
		expect(network?.vertices).toHaveLength(3);
		expect(network?.segments).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 }
		]);
		expect(network?.regions).toBeUndefined();
	});

	it('click-drag pulls symmetric handles', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		session.release();
		session.press({ x: 100, y: 0 }, 4, false);
		session.drag({ x: 130, y: 20 });
		session.release();
		const network = session.finish();
		expect(network?.segments[0].tangentEnd).toEqual({ x: -30, y: -20 });
		expect(session.outHandles.get(1)).toEqual({ x: 30, y: 20 });
		session.press({ x: 200, y: 0 }, 4, false);
		expect(session.network.segments[1].tangentStart).toEqual({ x: 30, y: 20 });
	});

	it('clicking the first point closes the path into a region', () => {
		const session = new PenSession();
		for (const point of [
			{ x: 0, y: 0 },
			{ x: 40, y: 0 },
			{ x: 40, y: 40 }
		]) {
			session.press(point, 4, false);
			session.release();
		}
		expect(session.canCloseAt({ x: 1, y: 1 }, 4)).toBe(true);
		expect(session.press({ x: 1, y: 1 }, 4, false)).toBe('closed');
		const network = session.finish();
		expect(network?.segments).toHaveLength(3);
		expect(network?.regions).toEqual([{ windingRule: 'NONZERO', loops: [[2, 0, 1]] }]);
		expect(session.active).toBeNull();
	});

	it('Shift constrains the new point to 45 degrees', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		session.release();
		session.press({ x: 100, y: 12 }, 4, true);
		expect(session.network.vertices[1].y).toBeCloseTo(0);
		expect(session.network.vertices[1].x).toBeCloseTo(Math.hypot(100, 12));
	});

	it('branches from an existing vertex and closes a loop through existing segments', () => {
		const session = new PenSession(polyline([0, 0], [40, 0], [40, 40]));
		expect(session.press({ x: 40, y: 40 }, 4, false)).toBe('continued');
		expect(session.press({ x: 0, y: 40 }, 4, false)).toBe('added');
		session.release();
		expect(session.press({ x: 0, y: 0 }, 4, false)).toBe('connected');
		const network = session.finish();
		expect(network?.segments).toHaveLength(4);
		expect(network?.regions).toHaveLength(1);
		expect(network?.regions?.[0].loops[0]).toHaveLength(4);
	});

	it('branching from a middle vertex keeps the original path', () => {
		const session = new PenSession(polyline([0, 0], [40, 0], [80, 0]));
		session.press({ x: 40, y: 0 }, 4, false);
		session.press({ x: 40, y: 40 }, 4, false);
		const network = session.finish();
		expect(segmentsAt(network as VectorNetwork, 1)).toHaveLength(3);
	});

	it('undoes the last point while building', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		session.release();
		session.press({ x: 50, y: 0 }, 4, false);
		session.release();
		expect(session.undoLastPoint()).toBe(true);
		expect(session.network.vertices).toHaveLength(1);
		expect(session.active).toBe(0);
		expect(session.undoLastPoint()).toBe(true);
		expect(session.undoLastPoint()).toBe(false);
	});

	it('a lone point commits nothing', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		expect(session.finish()).toBeNull();
	});

	it('produces networks the schema accepts', () => {
		const session = new PenSession();
		session.press({ x: 0, y: 0 }, 4, false);
		session.release();
		session.press({ x: 40, y: 0 }, 4, false);
		session.drag({ x: 60, y: 10 });
		session.release();
		session.press({ x: 0, y: 0 }, 4, false);
		expect(isValidVector(session.finish())).toBe(true);
	});
});

describe('network editing', () => {
	it('delete removes the vertex and its segments', () => {
		const result = deleteVertices(polyline([0, 0], [10, 0], [20, 0], [30, 0]), new Set([1]));
		expect(result.vertices).toHaveLength(3);
		expect(result.segments).toEqual([{ start: 1, end: 2 }]);
	});

	it('heal reconnects the neighbours of a deleted vertex on an open path', () => {
		const result = healVertices(polyline([0, 0], [10, 0], [20, 0], [30, 0]), new Set([1]));
		expect(result.vertices.map((vertex) => vertex.x)).toEqual([0, 20, 30]);
		expect(result.segments).toHaveLength(2);
		expect(result.segments).toContainEqual({ start: 0, end: 1 });
		expect(result.segments).toContainEqual({ start: 1, end: 2 });
	});

	it('heal keeps the tangents at the far ends and the region of a closed loop', () => {
		const network: VectorNetwork = {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 40, y: 0 },
				{ x: 40, y: 40 },
				{ x: 0, y: 40 }
			],
			segments: [
				{ start: 0, end: 1, tangentStart: { x: 5, y: -5 } },
				{ start: 1, end: 2 },
				{ start: 2, end: 3 },
				{ start: 3, end: 0 }
			],
			regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
		};
		const healed = healVertices(network, new Set([1]));
		expect(healed.vertices).toHaveLength(3);
		expect(healed.segments).toHaveLength(3);
		expect(healed.segments[0].tangentStart).toEqual({ x: 5, y: -5 });
		expect(healed.regions?.[0].loops[0]).toHaveLength(3);
		const deleted = deleteVertices(network, new Set([1]));
		expect(deleted.regions).toBeUndefined();
	});

	it('join of two endpoints produces a connected segment, and a region when it closes', () => {
		const open = polyline([0, 0], [40, 0], [40, 40]);
		expect(isEndpoint(open, 0)).toBe(true);
		expect(isEndpoint(open, 1)).toBe(false);
		const joined = joinVertices(open, 2, 0);
		expect(joined.segments).toHaveLength(3);
		expect(joined.segments[2]).toEqual({ start: 2, end: 0 });
		expect(joined.regions).toHaveLength(1);
		expect(joinVertices(joined, 2, 0).segments).toHaveLength(3);
	});

	it('join of two separate paths connects them without a region', () => {
		const network: VectorNetwork = {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 50, y: 0 },
				{ x: 60, y: 0 }
			],
			segments: [
				{ start: 0, end: 1 },
				{ start: 2, end: 3 }
			]
		};
		const joined = joinVertices(network, 1, 2);
		expect(joined.segments).toHaveLength(3);
		expect(joined.regions).toBeUndefined();
	});

	it('moves vertices', () => {
		const moved = moveVertices(polyline([0, 0], [10, 0]), new Set([1]), { x: 5, y: 7 });
		expect(moved.vertices[1]).toEqual({ x: 15, y: 7 });
		expect(moved.vertices[0]).toEqual({ x: 0, y: 0 });
	});

	it('paints a region and clears it again', () => {
		const network: VectorNetwork = {
			...polyline([0, 0], [40, 0], [40, 40], [0, 0]),
			regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }]
		};
		const fills = [
			{
				type: 'SOLID' as const,
				visible: true,
				opacity: 1,
				blendMode: 'NORMAL' as const,
				color: { r: 1, g: 0, b: 0 }
			}
		];
		const painted = paintRegion(network, 0, fills);
		expect(painted.regions?.[0].fills).toEqual(fills);
		expect(paintRegion(painted, 0, undefined).regions?.[0].fills).toBeUndefined();
		expect(network.regions?.[0].fills).toBeUndefined();
	});
});

describe('handle mirroring', () => {
	it('NONE leaves the other handle', () => {
		expect(mirroredTangent('NONE', { x: 10, y: 0 }, { x: -3, y: 4 })).toEqual({ x: -3, y: 4 });
	});

	it('ANGLE keeps the other length and points it opposite', () => {
		const other = mirroredTangent('ANGLE', { x: 10, y: 0 }, { x: 0, y: 5 });
		expect(other.x).toBeCloseTo(-5);
		expect(other.y).toBeCloseTo(0);
	});

	it('ANGLE with a zero handle borrows the moved length', () => {
		const other = mirroredTangent('ANGLE', { x: 0, y: 8 }, { x: 0, y: 0 });
		expect(other.x).toBeCloseTo(0);
		expect(other.y).toBeCloseTo(-8);
	});

	it('ANGLE_AND_LENGTH is the exact opposite', () => {
		expect(mirroredTangent('ANGLE_AND_LENGTH', { x: 4, y: -2 }, { x: 9, y: 9 })).toEqual({
			x: -4,
			y: 2
		});
	});

	function smoothNetwork(mode: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'): VectorNetwork {
		return {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 50, y: 0, handleMirroring: mode },
				{ x: 100, y: 0 }
			],
			segments: [
				{ start: 0, end: 1, tangentEnd: { x: -10, y: 0 } },
				{ start: 1, end: 2, tangentStart: { x: 10, y: 0 } }
			]
		};
	}

	it('dragging a handle moves the other per the vertex mode', () => {
		const exact = dragHandle(smoothNetwork('ANGLE_AND_LENGTH'), 1, 1, { x: 0, y: 20 }, false);
		expect(exact.segments[0].tangentEnd).toEqual({ x: 0, y: -20 });
		const angle = dragHandle(smoothNetwork('ANGLE'), 1, 1, { x: 0, y: 20 }, false);
		expect(angle.segments[0].tangentEnd?.y).toBeCloseTo(-10);
		expect(angle.segments[0].tangentEnd?.x).toBeCloseTo(0);
		const none = dragHandle(smoothNetwork('NONE'), 1, 1, { x: 0, y: 20 }, false);
		expect(none.segments[0].tangentEnd).toEqual({ x: -10, y: 0 });
	});

	it('Alt breaks mirroring for the drag', () => {
		const broken = dragHandle(smoothNetwork('ANGLE_AND_LENGTH'), 1, 1, { x: 0, y: 20 }, true);
		expect(broken.segments[0].tangentEnd).toEqual({ x: -10, y: 0 });
		expect(broken.segments[1].tangentStart).toEqual({ x: 0, y: 20 });
	});

	it('setting a mode makes the second handle follow the first', () => {
		const network = smoothNetwork('NONE');
		network.segments[1].tangentStart = { x: 0, y: 7 };
		const result = setMirroring(network, new Set([1]), 'ANGLE_AND_LENGTH');
		expect(result.vertices[1].handleMirroring).toBe('ANGLE_AND_LENGTH');
		expect(result.segments[1].tangentStart).toEqual({ x: 10, y: 0 });
	});
});

describe('bend tool', () => {
	it('dragging a corner vertex curves both segments with mirrored handles', () => {
		const bent = bendVertex(polyline([0, 0], [50, 0], [100, 0]), 1, { x: 0, y: 20 });
		expect(bent.segments[1].tangentStart).toEqual({ x: 0, y: 20 });
		expect(bent.segments[0].tangentEnd).toEqual({ x: 0, y: -20 });
		expect(hasHandles(bent, 1)).toBe(true);
	});

	it('clicking a vertex with handles removes them', () => {
		const bent = bendVertex(polyline([0, 0], [50, 0], [100, 0]), 1, { x: 0, y: 20 });
		const cleared = removeHandles(bent, 1);
		expect(hasHandles(cleared, 1)).toBe(false);
	});

	it('dragging a segment moves the curve point by the drag', () => {
		const line = polyline([0, 0], [100, 0]);
		const bent = bendSegment(line, 0, 0.5, { x: 0, y: 30 });
		const controls = segmentControls(bent, bent.segments[0]);
		expect(cubicPoint(controls, 0.5).y).toBeCloseTo(30);
		expect(cubicPoint(controls, 0.5).x).toBeCloseTo(50);
	});
});

describe('geometry', () => {
	it('bounds follow the curve, not the control points', () => {
		const network: VectorNetwork = {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 }
			],
			segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 100 }, tangentEnd: { x: 0, y: 100 } }]
		};
		const bounds = networkBounds(network);
		expect(bounds?.height).toBeCloseTo(75, 0);
		const normalized = normalizeNetwork(polyline([10, 20], [30, 60]));
		expect(normalized.origin).toEqual({ x: 10, y: 20 });
		expect(normalized.network.vertices[0]).toEqual({ x: 0, y: 0 });
		expect(normalized.width).toBe(20);
		expect(normalized.height).toBe(40);
	});

	it('answers signed distance and regions exactly', () => {
		const square: VectorNetwork = {
			...polyline([0, 0], [40, 0], [40, 40], [0, 40], [0, 0]),
			regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
		};
		expect(regionAt(square, { x: 20, y: 20 })).toBe(0);
		expect(regionAt(square, { x: 60, y: 20 })).toBe(-1);
		expect(networkSignedDistance(square, { x: 20, y: 20 })).toBeCloseTo(-20);
		expect(networkSignedDistance(square, { x: 50, y: 20 })).toBeCloseTo(10);
		const open = polyline([0, 0], [40, 0]);
		expect(networkSignedDistance(open, { x: 20, y: 5 })).toBeCloseTo(5);
	});
});

describe('corner radius', () => {
	it('replaces a rounded corner with an arc between two new vertices', () => {
		const network = polyline([0, 0], [100, 0], [100, 100]);
		network.vertices[1].cornerRadius = 20;
		const expanded = expandCornerRadii(network);
		expect(expanded.vertices).toHaveLength(5);
		expect(expanded.segments).toHaveLength(3);
		expect(expanded.vertices[3]).toEqual({ x: 80, y: 0 });
		expect(expanded.vertices[4].x).toBeCloseTo(100);
		expect(expanded.vertices[4].y).toBeCloseTo(20);
		const arc = expanded.segments[1];
		const controls = segmentControls(expanded, arc);
		const middle = cubicPoint(controls, 0.5);
		const centre = { x: 80, y: 20 };
		expect(Math.hypot(middle.x - centre.x, middle.y - centre.y)).toBeCloseTo(20, 0);
		expect(network.vertices).toHaveLength(3);
	});

	it('clamps the radius to half the neighbouring edge', () => {
		const network = polyline([0, 0], [100, 0], [100, 30]);
		network.vertices[1].cornerRadius = 80;
		const expanded = expandCornerRadii(network);
		expect(expanded.vertices[4].y).toBeCloseTo(15);
	});

	it('leaves networks without radii untouched', () => {
		const network = polyline([0, 0], [10, 0]);
		expect(expandCornerRadii(network)).toBe(network);
	});
});

describe('freehand fitting', () => {
	function arcPoints(): { x: number; y: number }[] {
		const points = [];
		for (let step = 0; step <= 80; step += 1) {
			const angle = (step / 80) * Math.PI;
			const jitter = Math.sin(step * 12.9898) * 0.4;
			points.push({
				x: 100 * Math.cos(angle) + jitter,
				y: 100 * Math.sin(angle) - jitter
			});
		}
		return points;
	}

	function distanceToFit(network: VectorNetwork, point: { x: number; y: number }): number {
		return Math.abs(networkSignedDistance(network, point));
	}

	it('stays within the tolerance of the input points', () => {
		const points = arcPoints();
		for (const tolerance of [1, 2, 5]) {
			const network = fitFreehand(points, tolerance);
			const worst = Math.max(...points.map((point) => distanceToFit(network, point)));
			expect(worst).toBeLessThanOrEqual(tolerance);
		}
	});

	it('uses fewer curves as the tolerance grows and far fewer than points', () => {
		const points = arcPoints();
		const tight = fitFreehand(points, 0.5);
		const loose = fitFreehand(points, 5);
		expect(loose.segments.length).toBeLessThanOrEqual(tight.segments.length);
		expect(tight.segments.length).toBeLessThan(points.length / 4);
		expect(isValidVector(loose)).toBe(true);
	});

	it('fits a straight stroke with one segment', () => {
		const line = Array.from({ length: 20 }, (_, index) => ({ x: index * 5, y: index * 2 }));
		expect(fitFreehand(line, 1).segments).toHaveLength(1);
	});

	it('returns nothing for fewer than two distinct points', () => {
		expect(fitFreehand([{ x: 1, y: 1 }], 1).segments).toHaveLength(0);
		expect(
			fitFreehand(
				[
					{ x: 1, y: 1 },
					{ x: 1, y: 1 }
				],
				1
			).segments
		).toHaveLength(0);
	});
});
