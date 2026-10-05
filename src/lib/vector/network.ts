// Pure operations on vector networks: building (the pen), editing (select, delete, heal, join)
// and region bookkeeping. Functions named `append*` / `connect*` mutate the network they get (the
// pen works on a private draft); every other function returns a new network.

import type { Paint, Vec2, VectorNetwork, VectorSegment } from '../document/types';
import { copyNetwork, defined, tangentOf, type Point } from './geometry';

export function emptyNetwork(): VectorNetwork {
	return { vertices: [], segments: [] };
}

export function segmentsAt(network: VectorNetwork, vertex: number): number[] {
	const found: number[] = [];
	network.segments.forEach((segment, index) => {
		if (segment.start === vertex || segment.end === vertex) found.push(index);
	});
	return found;
}

export function degreeOf(network: VectorNetwork, vertex: number): number {
	return segmentsAt(network, vertex).length;
}

export function otherEnd(segment: VectorSegment, vertex: number): number {
	if (segment.start === vertex) return segment.end;
	return segment.start;
}

/** The tangent the segment has at `vertex` (zero when straight there). */
export function tangentAtVertex(segment: VectorSegment, vertex: number): Vec2 {
	if (segment.start === vertex) return tangentOf(segment.tangentStart);
	return tangentOf(segment.tangentEnd);
}

export function setTangentAtVertex(segment: VectorSegment, vertex: number, tangent: Vec2): void {
	const value = hasLength(tangent) ? { x: tangent.x, y: tangent.y } : undefined;
	if (segment.start === vertex) {
		if (value) segment.tangentStart = value;
		else delete segment.tangentStart;
	}
	if (segment.end === vertex) {
		if (value) segment.tangentEnd = value;
		else delete segment.tangentEnd;
	}
}

function hasLength(vector: Vec2): boolean {
	return vector.x !== 0 || vector.y !== 0;
}

// ---------- building ----------

export function appendVertex(network: VectorNetwork, point: Point): number {
	network.vertices.push({ x: point.x, y: point.y });
	return network.vertices.length - 1;
}

export function connectVertices(
	network: VectorNetwork,
	start: number,
	end: number,
	tangentStart?: Vec2,
	tangentEnd?: Vec2
): number {
	const segment: VectorSegment = { start, end };
	if (tangentStart && hasLength(tangentStart)) segment.tangentStart = { ...tangentStart };
	if (tangentEnd && hasLength(tangentEnd)) segment.tangentEnd = { ...tangentEnd };
	network.segments.push(segment);
	return network.segments.length - 1;
}

/** Shortest chain of segments from `from` to `to` that avoids `excluded`, or null. */
function pathBetween(
	network: VectorNetwork,
	from: number,
	to: number,
	excluded: number
): number[] | null {
	if (from === to) return [];
	const arrivedBy = new Map<number, { vertex: number; segment: number }>();
	const queue = [from];
	const seen = new Set<number>([from]);
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		for (const index of segmentsAt(network, current)) {
			if (index === excluded) continue;
			const next = otherEnd(network.segments[index], current);
			if (seen.has(next)) continue;
			seen.add(next);
			arrivedBy.set(next, { vertex: current, segment: index });
			if (next === to) return unwind(arrivedBy, from, to);
			queue.push(next);
		}
	}
	return null;
}

function unwind(
	arrivedBy: Map<number, { vertex: number; segment: number }>,
	from: number,
	to: number
): number[] {
	const chain: number[] = [];
	let current = to;
	while (current !== from) {
		const step = defined(arrivedBy.get(current));
		chain.unshift(step.segment);
		current = step.vertex;
	}
	return chain;
}

function sameLoop(first: readonly number[], second: readonly number[]): boolean {
	if (first.length !== second.length) return false;
	const sorted = [...first].sort((left, right) => left - right);
	const other = [...second].sort((left, right) => left - right);
	return sorted.every((value, index) => value === other[index]);
}

/**
 * When `segmentIndex` closes a cycle with other segments, that cycle becomes a fill region
 * (mutates). Returns whether a region was added.
 */
export function addRegionClosedBy(network: VectorNetwork, segmentIndex: number): boolean {
	const segment = network.segments[segmentIndex];
	const chain = pathBetween(network, segment.end, segment.start, segmentIndex);
	if (!chain) return false;
	const loop = [segmentIndex, ...chain];
	const regions = network.regions ?? [];
	if (regions.some((region) => region.loops.some((existing) => sameLoop(existing, loop)))) {
		return false;
	}
	regions.push({ windingRule: 'NONZERO', loops: [loop] });
	network.regions = regions;
	return true;
}

// ---------- removing ----------

interface Remap {
	segments: Map<number, number>;
	vertices: Map<number, number>;
}

function indexMap(count: number, removed: ReadonlySet<number>): Map<number, number> {
	const map = new Map<number, number>();
	let next = 0;
	for (let index = 0; index < count; index += 1) {
		if (removed.has(index)) continue;
		map.set(index, next);
		next += 1;
	}
	return map;
}

function rebuild(
	network: VectorNetwork,
	removedSegments: ReadonlySet<number>,
	removedVertices: ReadonlySet<number>
): { network: VectorNetwork; remap: Remap } {
	const remap: Remap = {
		segments: indexMap(network.segments.length, removedSegments),
		vertices: indexMap(network.vertices.length, removedVertices)
	};
	const rebuilt: VectorNetwork = {
		vertices: network.vertices.filter((_, index) => !removedVertices.has(index)),
		segments: network.segments
			.filter((_, index) => !removedSegments.has(index))
			.map((segment) => ({
				...segment,
				start: defined(remap.vertices.get(segment.start)),
				end: defined(remap.vertices.get(segment.end))
			}))
	};
	const regions = [];
	for (const region of network.regions ?? []) {
		const touched = region.loops.some((loop) => loop.some((index) => removedSegments.has(index)));
		if (touched) continue;
		const loops = region.loops.map((loop) =>
			loop.map((index) => defined(remap.segments.get(index)))
		);
		regions.push({ ...region, loops });
	}
	if (regions.length > 0) rebuilt.regions = regions;
	return { network: rebuilt, remap };
}

export function deleteSegments(
	network: VectorNetwork,
	segments: ReadonlySet<number>
): VectorNetwork {
	return rebuild(copyNetwork(network), segments, new Set()).network;
}

/** Removes the vertices and every segment touching them. */
export function deleteVertices(
	network: VectorNetwork,
	vertices: ReadonlySet<number>
): VectorNetwork {
	const doomed = new Set<number>();
	network.segments.forEach((segment, index) => {
		if (vertices.has(segment.start) || vertices.has(segment.end)) doomed.add(index);
	});
	return rebuild(copyNetwork(network), doomed, vertices).network;
}

/**
 * Removes the vertices but reconnects their neighbours: a vertex with exactly two segments is
 * replaced by one segment between the neighbours (regions keep their loop). Other vertices are
 * deleted with their segments.
 */
export function healVertices(network: VectorNetwork, vertices: ReadonlySet<number>): VectorNetwork {
	const working = copyNetwork(network);
	const removedSegments = new Set<number>();
	const deletedVertices = new Set<number>();
	for (const vertex of vertices) {
		if (healOne(working, vertex, removedSegments)) {
			deletedVertices.add(vertex);
			continue;
		}
		deleteAround(working, vertex, removedSegments);
		deletedVertices.add(vertex);
	}
	return rebuild(working, removedSegments, deletedVertices).network;
}

function deleteAround(network: VectorNetwork, vertex: number, removed: Set<number>): void {
	segmentsAt(network, vertex).forEach((index) => removed.add(index));
}

function healOne(network: VectorNetwork, vertex: number, removed: Set<number>): boolean {
	const live = segmentsAt(network, vertex).filter((index) => !removed.has(index));
	if (live.length !== 2) return false;
	const [keptIndex, droppedIndex] = live;
	const kept = network.segments[keptIndex];
	const dropped = network.segments[droppedIndex];
	const nearEnd = otherEnd(kept, vertex);
	const farEnd = otherEnd(dropped, vertex);
	if (nearEnd === farEnd) return false;
	const startTangent = tangentAtVertex(kept, nearEnd);
	const endTangent = tangentAtVertex(dropped, farEnd);
	kept.start = nearEnd;
	kept.end = farEnd;
	setTangentAtVertex(kept, nearEnd, startTangent);
	setTangentAtVertex(kept, farEnd, endTangent);
	removeLoopEntry(network, droppedIndex);
	removed.add(droppedIndex);
	return true;
}

/** The healed segment replaces its neighbour inside loops: drop the neighbour from them. */
function removeLoopEntry(network: VectorNetwork, segmentIndex: number): void {
	for (const region of network.regions ?? []) {
		region.loops = region.loops.map((loop) => loop.filter((index) => index !== segmentIndex));
	}
}

// ---------- joining ----------

/** A segment between two vertices, closing a region when it completes a cycle. */
export function joinVertices(network: VectorNetwork, first: number, second: number): VectorNetwork {
	const joined = copyNetwork(network);
	if (first === second) return joined;
	const exists = joined.segments.some(
		(segment) =>
			(segment.start === first && segment.end === second) ||
			(segment.start === second && segment.end === first)
	);
	if (exists) return joined;
	const index = connectVertices(joined, first, second);
	addRegionClosedBy(joined, index);
	return joined;
}

/** Endpoints are vertices with at most one segment: the ones a join may connect. */
export function isEndpoint(network: VectorNetwork, vertex: number): boolean {
	return degreeOf(network, vertex) <= 1;
}

// ---------- moving and styling ----------

export function moveVertices(
	network: VectorNetwork,
	vertices: ReadonlySet<number>,
	delta: Point
): VectorNetwork {
	const moved = copyNetwork(network);
	for (const index of vertices) {
		moved.vertices[index].x += delta.x;
		moved.vertices[index].y += delta.y;
	}
	return moved;
}

export function setCornerRadius(
	network: VectorNetwork,
	vertices: ReadonlySet<number>,
	radius: number
): VectorNetwork {
	const changed = copyNetwork(network);
	for (const index of vertices) {
		if (radius > 0) changed.vertices[index].cornerRadius = radius;
		else delete changed.vertices[index].cornerRadius;
	}
	return changed;
}

export function paintRegion(
	network: VectorNetwork,
	regionIndex: number,
	fills: Paint[] | undefined
): VectorNetwork {
	const painted = copyNetwork(network);
	const region = painted.regions?.[regionIndex];
	if (!region) return painted;
	if (fills) region.fills = fills;
	else delete region.fills;
	return painted;
}
