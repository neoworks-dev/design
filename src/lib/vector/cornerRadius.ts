// Per-vertex corner radius (issue #62). The stored network keeps the sharp vertex and its
// `cornerRadius`; drawing and hit testing use the network this module expands: the corner is
// replaced by two vertices joined by a circular arc (a cubic with the usual handle length).
// Only corners between two straight segments round; a vertex with handles is already smooth.

import type { VectorNetwork, VectorSegment } from '../document/types';
import { copyNetwork, defined, isStraight } from './geometry';
import { segmentsAt } from './network';

interface Corner {
	vertex: number;
	first: number;
	second: number;
	firstPoint: { x: number; y: number };
	secondPoint: { x: number; y: number };
	firstHandle: { x: number; y: number };
	secondHandle: { x: number; y: number };
}

export function hasCornerRadii(network: VectorNetwork): boolean {
	return network.vertices.some(
		(vertex) => vertex.cornerRadius !== undefined && vertex.cornerRadius > 0
	);
}

function unit(
	from: { x: number; y: number },
	to: { x: number; y: number }
): { x: number; y: number; length: number } {
	const x = to.x - from.x;
	const y = to.y - from.y;
	const length = Math.hypot(x, y);
	if (length === 0) return { x: 0, y: 0, length: 0 };
	return { x: x / length, y: y / length, length };
}

function planCorner(network: VectorNetwork, vertexIndex: number): Corner | null {
	const vertex = network.vertices[vertexIndex];
	const radius = vertex.cornerRadius;
	if (radius === undefined || radius <= 0) return null;
	const incident = segmentsAt(network, vertexIndex);
	if (incident.length !== 2) return null;
	const [first, second] = incident;
	const firstSegment = network.segments[first];
	const secondSegment = network.segments[second];
	if (!isStraight(firstSegment) || !isStraight(secondSegment)) return null;
	const firstOther =
		network.vertices[firstSegment.start === vertexIndex ? firstSegment.end : firstSegment.start];
	const secondOther =
		network.vertices[secondSegment.start === vertexIndex ? secondSegment.end : secondSegment.start];
	const toFirst = unit(vertex, firstOther);
	const toSecond = unit(vertex, secondOther);
	if (toFirst.length === 0 || toSecond.length === 0) return null;
	const cosine = Math.max(-1, Math.min(1, toFirst.x * toSecond.x + toFirst.y * toSecond.y));
	const angle = Math.acos(cosine);
	if (angle < 1e-3 || Math.PI - angle < 1e-3) return null;
	const reach = Math.min(radius / Math.tan(angle / 2), toFirst.length / 2, toSecond.length / 2);
	const effectiveRadius = reach * Math.tan(angle / 2);
	const sweep = Math.PI - angle;
	const handleLength = (4 / 3) * Math.tan(sweep / 4) * effectiveRadius;
	return {
		vertex: vertexIndex,
		first,
		second,
		firstPoint: { x: vertex.x + toFirst.x * reach, y: vertex.y + toFirst.y * reach },
		secondPoint: { x: vertex.x + toSecond.x * reach, y: vertex.y + toSecond.y * reach },
		firstHandle: { x: -toFirst.x * handleLength, y: -toFirst.y * handleLength },
		secondHandle: { x: -toSecond.x * handleLength, y: -toSecond.y * handleLength }
	};
}

function moveEnd(segment: VectorSegment, vertex: number, replacement: number): void {
	if (segment.start === vertex) segment.start = replacement;
	else segment.end = replacement;
}

/** The network with every rounded corner replaced by its arc; the input is not changed. */
export function expandCornerRadii(network: VectorNetwork): VectorNetwork {
	if (!hasCornerRadii(network)) return network;
	const working = copyNetwork(network);
	const corners: Corner[] = [];
	const fillers: VectorSegment[] = [];
	for (let vertex = 0; vertex < network.vertices.length; vertex += 1) {
		const corner = planCorner(network, vertex);
		if (!corner) continue;
		const firstVertex = working.vertices.push({ ...corner.firstPoint }) - 1;
		const secondVertex = working.vertices.push({ ...corner.secondPoint }) - 1;
		moveEnd(working.segments[corner.first], corner.vertex, firstVertex);
		moveEnd(working.segments[corner.second], corner.vertex, secondVertex);
		corners.push(corner);
		fillers.push({
			start: firstVertex,
			end: secondVertex,
			tangentStart: corner.firstHandle,
			tangentEnd: corner.secondHandle
		});
	}
	return withFillers(working, corners, fillers);
}

function withFillers(
	network: VectorNetwork,
	corners: readonly Corner[],
	fillers: readonly VectorSegment[]
): VectorNetwork {
	const segments: VectorSegment[] = [];
	const remap = new Map<number, number>();
	const fillerIndex: number[] = [];
	network.segments.forEach((segment, index) => {
		remap.set(index, segments.length);
		segments.push(segment);
		corners.forEach((corner, cornerIndex) => {
			if (Math.min(corner.first, corner.second) !== index) return;
			fillerIndex[cornerIndex] = segments.length;
			segments.push(fillers[cornerIndex]);
		});
	});
	const regions = (network.regions ?? []).map((region) => ({
		...region,
		loops: region.loops.map((loop) => expandLoop(loop, corners, remap, fillerIndex))
	}));
	const result: VectorNetwork = { vertices: network.vertices, segments };
	if (regions.length > 0) result.regions = regions;
	return result;
}

function expandLoop(
	loop: readonly number[],
	corners: readonly Corner[],
	remap: ReadonlyMap<number, number>,
	fillerIndex: readonly number[]
): number[] {
	const expanded: number[] = [];
	loop.forEach((segment, position) => {
		expanded.push(defined(remap.get(segment)));
		const next = loop[(position + 1) % loop.length];
		corners.forEach((corner, cornerIndex) => {
			const joins =
				(corner.first === segment && corner.second === next) ||
				(corner.second === segment && corner.first === next);
			if (joins) expanded.push(fillerIndex[cornerIndex]);
		});
	});
	return expanded;
}
