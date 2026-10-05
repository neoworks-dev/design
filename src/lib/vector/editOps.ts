// Pure edit operations of the vector edit mode on a (network, selection) pair: hit testing for
// the pointer, deleting, healing, joining and flattening. The tool applies the results.

import type { VectorNetwork } from '../document/types';
import { nearestOnSegment, tangentOf, validSegment, type Point } from './geometry';
import type { VectorHit } from './editState';
import {
	deleteSegments,
	deleteVertices,
	healVertices,
	isEndpoint,
	joinVertices,
	segmentsAt
} from './network';

/**
 * What is under `point` (local units): handles of `handleVertices` first, then vertices, then
 * segments. `radius` is the pick distance in the same units.
 */
export function hitNetwork(
	network: VectorNetwork,
	point: Point,
	radius: number,
	handleVertices: ReadonlySet<number>
): VectorHit | null {
	const handle = hitHandle(network, point, radius, handleVertices);
	if (handle) return handle;
	const vertex = hitVertex(network, point, radius);
	if (vertex >= 0) return { kind: 'vertex', index: vertex };
	return hitSegment(network, point, radius);
}

function hitHandle(
	network: VectorNetwork,
	point: Point,
	radius: number,
	vertices: ReadonlySet<number>
): VectorHit | null {
	for (const vertexIndex of vertices) {
		const vertex = network.vertices[vertexIndex];
		if (!vertex) continue;
		for (const segmentIndex of segmentsAt(network, vertexIndex)) {
			const segment = network.segments[segmentIndex];
			const tangent = tangentOf(
				segment.start === vertexIndex ? segment.tangentStart : segment.tangentEnd
			);
			if (tangent.x === 0 && tangent.y === 0) continue;
			const distance = Math.hypot(vertex.x + tangent.x - point.x, vertex.y + tangent.y - point.y);
			if (distance <= radius) return { kind: 'handle', segment: segmentIndex, vertex: vertexIndex };
		}
	}
	return null;
}

export function hitVertex(network: VectorNetwork, point: Point, radius: number): number {
	let best = -1;
	let bestDistance = radius;
	network.vertices.forEach((vertex, index) => {
		const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
		if (distance > bestDistance) return;
		best = index;
		bestDistance = distance;
	});
	return best;
}

function hitSegment(network: VectorNetwork, point: Point, radius: number): VectorHit | null {
	let best: VectorHit | null = null;
	let bestDistance = radius;
	network.segments.forEach((segment, index) => {
		if (!validSegment(network, segment)) return;
		const nearest = nearestOnSegment(network, segment, point);
		if (nearest.distance > bestDistance) return;
		best = { kind: 'segment', index, t: nearest.t };
		bestDistance = nearest.distance;
	});
	return best;
}

/** Vertices inside the local-space rectangle. */
export function verticesInRect(network: VectorNetwork, from: Point, to: Point): number[] {
	const minX = Math.min(from.x, to.x);
	const maxX = Math.max(from.x, to.x);
	const minY = Math.min(from.y, to.y);
	const maxY = Math.max(from.y, to.y);
	const inside: number[] = [];
	network.vertices.forEach((vertex, index) => {
		if (vertex.x >= minX && vertex.x <= maxX && vertex.y >= minY && vertex.y <= maxY) {
			inside.push(index);
		}
	});
	return inside;
}

export function endpointsOfSegments(
	network: VectorNetwork,
	segments: ReadonlySet<number>
): Set<number> {
	const vertices = new Set<number>();
	for (const index of segments) {
		const segment = network.segments[index];
		if (!segment) continue;
		vertices.add(segment.start);
		vertices.add(segment.end);
	}
	return vertices;
}

export interface Selection {
	vertices: ReadonlySet<number>;
	segments: ReadonlySet<number>;
}

/** Delete removes the selected vertices with their segments; heal reconnects the neighbours. */
export function deleteSelection(
	network: VectorNetwork,
	selection: Selection,
	heal: boolean
): VectorNetwork | null {
	if (selection.vertices.size === 0 && selection.segments.size === 0) return null;
	let result = network;
	if (selection.segments.size > 0) result = deleteSegments(result, selection.segments);
	if (selection.vertices.size === 0) return result;
	if (heal) return healVertices(result, selection.vertices);
	return deleteVertices(result, selection.vertices);
}

/** The two selected endpoints (or the endpoints of the selection) joined by a segment. */
export function joinSelection(network: VectorNetwork, selection: Selection): VectorNetwork | null {
	const vertices = [...selection.vertices].filter((vertex) => isEndpoint(network, vertex));
	if (vertices.length !== 2) return null;
	const joined = joinVertices(network, vertices[0], vertices[1]);
	if (joined.segments.length === network.segments.length) return null;
	return joined;
}

/** Drops vertices no segment uses; the rest of the network is untouched. */
export function flattenNetwork(network: VectorNetwork): VectorNetwork | null {
	const orphans = new Set<number>();
	network.vertices.forEach((_, index) => {
		if (segmentsAt(network, index).length === 0) orphans.add(index);
	});
	if (orphans.size === 0) return null;
	return deleteVertices(network, orphans);
}
