// Handle maths for vector editing (issue #62): mirroring modes, the bend tool and handle drags.
// A tangent is the vector from a vertex to the control point of one of its segments.

import type { Vec2, VectorNetwork, VectorVertex } from '../document/types';
import { copyNetwork, defined, segmentControls, type Point } from './geometry';
import { segmentsAt, setTangentAtVertex, tangentAtVertex } from './network';

export type HandleMirroring = NonNullable<VectorVertex['handleMirroring']>;

function opposite(vector: Vec2): Vec2 {
	return { x: 0 - vector.x, y: 0 - vector.y };
}

function lengthOf(vector: Vec2): number {
	return Math.hypot(vector.x, vector.y);
}

/**
 * Where the opposite handle goes when `moved` changes, per mirroring mode:
 * NONE leaves it, ANGLE keeps its length but points it opposite, ANGLE_AND_LENGTH is the exact
 * opposite of `moved`.
 */
export function mirroredTangent(mode: HandleMirroring, moved: Vec2, other: Vec2): Vec2 {
	if (mode === 'NONE') return other;
	if (mode === 'ANGLE_AND_LENGTH') return opposite(moved);
	const movedLength = lengthOf(moved);
	if (movedLength === 0) return other;
	let length = lengthOf(other);
	if (length === 0) length = movedLength;
	return { x: (0 - moved.x / movedLength) * length, y: (0 - moved.y / movedLength) * length };
}

function mirroringOf(network: VectorNetwork, vertex: number): HandleMirroring {
	const mode = network.vertices[vertex].handleMirroring;
	if (mode) return mode;
	return 'NONE';
}

/**
 * Drags the handle of `segmentIndex` at `vertex` to `tangent`. The other handle at the vertex
 * follows per the vertex's mirroring mode unless `breakMirroring` (Alt) is set for this drag.
 */
export function dragHandle(
	network: VectorNetwork,
	segmentIndex: number,
	vertex: number,
	tangent: Vec2,
	breakMirroring: boolean
): VectorNetwork {
	const result = copyNetwork(network);
	setTangentAtVertex(result.segments[segmentIndex], vertex, tangent);
	if (breakMirroring) return result;
	const mode = mirroringOf(result, vertex);
	if (mode === 'NONE') return result;
	const others = segmentsAt(result, vertex).filter((index) => index !== segmentIndex);
	if (others.length !== 1) return result;
	const other = result.segments[others[0]];
	const mirrored = mirroredTangent(mode, tangent, tangentAtVertex(other, vertex));
	setTangentAtVertex(other, vertex, mirrored);
	return result;
}

/**
 * Sets the mirroring mode on vertices and snaps the second handle to the first so the mode
 * holds from now on.
 */
export function setMirroring(
	network: VectorNetwork,
	vertices: ReadonlySet<number>,
	mode: HandleMirroring
): VectorNetwork {
	let result = copyNetwork(network);
	for (const vertex of vertices) {
		result.vertices[vertex].handleMirroring = mode;
		const incident = segmentsAt(result, vertex);
		if (incident.length !== 2 || mode === 'NONE') continue;
		const first = tangentAtVertex(result.segments[incident[0]], vertex);
		result = dragHandle(result, incident[0], vertex, first, false);
	}
	return result;
}

/** Bend tool click on a vertex that has handles: remove them all. */
export function removeHandles(network: VectorNetwork, vertex: number): VectorNetwork {
	const result = copyNetwork(network);
	for (const index of segmentsAt(result, vertex)) {
		setTangentAtVertex(result.segments[index], vertex, { x: 0, y: 0 });
	}
	result.vertices[vertex].handleMirroring = 'NONE';
	return result;
}

export function hasHandles(network: VectorNetwork, vertex: number): boolean {
	return segmentsAt(network, vertex).some((index) => {
		const tangent = tangentAtVertex(network.segments[index], vertex);
		return tangent.x !== 0 || tangent.y !== 0;
	});
}

/**
 * Bend tool drag on a vertex: corner becomes curved. The drag vector is the outgoing handle and
 * its opposite the incoming one (mirrored), so the path flows smoothly through the vertex.
 */
export function bendVertex(network: VectorNetwork, vertex: number, drag: Vec2): VectorNetwork {
	const result = copyNetwork(network);
	const incident = segmentsAt(result, vertex);
	const outgoing = incident.filter((index) => result.segments[index].start === vertex);
	const incoming = incident.filter((index) => result.segments[index].end === vertex);
	const outwardSegments = [...outgoing];
	const inwardSegments = [...incoming];
	if (outwardSegments.length === 0 && inwardSegments.length > 1) {
		outwardSegments.push(defined(inwardSegments.pop()));
	}
	if (inwardSegments.length === 0 && outwardSegments.length > 1) {
		inwardSegments.push(defined(outwardSegments.pop()));
	}
	for (const index of outwardSegments) setTangentAtVertex(result.segments[index], vertex, drag);
	for (const index of inwardSegments) {
		setTangentAtVertex(result.segments[index], vertex, opposite(drag));
	}
	result.vertices[vertex].handleMirroring = 'ANGLE_AND_LENGTH';
	return result;
}

const MIN_BEND_PARAMETER = 0.12;

/**
 * Bend tool drag on a segment: the curve point at `t` follows `delta`. Both controls move by
 * the same amount, chosen so the point at `t` moves exactly by `delta`.
 */
export function bendSegment(
	network: VectorNetwork,
	segmentIndex: number,
	t: number,
	delta: Point
): VectorNetwork {
	const result = copyNetwork(network);
	const segment = result.segments[segmentIndex];
	const clamped = Math.min(1 - MIN_BEND_PARAMETER, Math.max(MIN_BEND_PARAMETER, t));
	const weight = 3 * clamped * (1 - clamped);
	const shift = { x: delta.x / weight, y: delta.y / weight };
	const controls = segmentControls(result, segment);
	const start = result.vertices[segment.start];
	const end = result.vertices[segment.end];
	segment.tangentStart = {
		x: controls.firstControl.x + shift.x - start.x,
		y: controls.firstControl.y + shift.y - start.y
	};
	segment.tangentEnd = {
		x: controls.secondControl.x + shift.x - end.x,
		y: controls.secondControl.y + shift.y - end.y
	};
	return result;
}
