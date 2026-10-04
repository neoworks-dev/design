// Planning for align, distribute spacing and tidy up (docs/research/interactions.md section 13).
// All three work on absolute bounds and move nodes in screen axes (`parentDelta` converts the
// move into the parent's space), so rotated ancestors behave like they do for nudging. Locked
// nodes and auto layout children never move: the layout owns the latter's position.

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type NodeId,
	type Rect,
	type Vec2
} from '../document';
import { parentDelta, translated } from './nudge';
import { isAutoLayoutChild, isPositioned, topLevelIds, unionBounds } from './selectionOps';

export type AlignEdge =
	'left' | 'right' | 'top' | 'bottom' | 'horizontal-center' | 'vertical-center';
export type DistributeAxis = 'horizontal' | 'vertical';

/** Gaps closer than this (pixels) count as the same gap when looking for the most common one. */
const GAP_TOLERANCE = 0.5;

interface Participant {
	id: NodeId;
	bounds: Rect;
	locked: boolean;
}

/** Top-level selected nodes that sit freely (not in an auto layout flow), with their bounds. */
function freeParticipants(reader: DocumentReader, ids: readonly NodeId[]): Participant[] {
	const participants: Participant[] = [];
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (!isPositioned(node)) continue;
		if (isAutoLayoutChild(reader, node)) continue;
		participants.push({ id, bounds: reader.cache.absoluteBounds(id), locked: node.locked });
	}
	return participants;
}

/** Move one node by a screen-axis delta; nothing for a zero delta or a locked node. */
function planMoveBy(reader: DocumentReader, id: NodeId, deltaX: number, deltaY: number): Change[] {
	if (deltaX === 0 && deltaY === 0) return [];
	const node = reader.requireNode(id);
	if (!isPositioned(node) || node.locked) return [];
	const delta = parentDelta(reader, node, deltaX, deltaY);
	return planSetProps(reader, id, { transform: translated(node.transform, delta.x, delta.y) });
}

// ---------- align ----------

/**
 * The rectangle to align to: the parent frame for a single node, the selection bounds for
 * several. A single node directly on a page has nothing to align to.
 */
function alignReference(reader: DocumentReader, participants: Participant[]): Rect | null {
	if (participants.length > 1) return unionBounds(participants.map((entry) => entry.bounds));
	if (participants.length === 0) return null;
	const node = reader.requireNode(participants[0].id);
	if (node.parentId === null) return null;
	if (reader.requireNode(node.parentId).type === 'PAGE') return null;
	return reader.cache.absoluteBounds(node.parentId);
}

function alignDelta(edge: AlignEdge, bounds: Rect, reference: Rect): Vec2 {
	switch (edge) {
		case 'left':
			return { x: reference.x - bounds.x, y: 0 };
		case 'right':
			return { x: reference.x + reference.width - (bounds.x + bounds.width), y: 0 };
		case 'top':
			return { x: 0, y: reference.y - bounds.y };
		case 'bottom':
			return { x: 0, y: reference.y + reference.height - (bounds.y + bounds.height) };
		case 'horizontal-center':
			return {
				x: reference.x + reference.width / 2 - (bounds.x + bounds.width / 2),
				y: 0
			};
		case 'vertical-center':
			return {
				x: 0,
				y: reference.y + reference.height / 2 - (bounds.y + bounds.height / 2)
			};
	}
}

export function planAlign(
	reader: DocumentReader,
	ids: readonly NodeId[],
	edge: AlignEdge
): Change[] {
	const participants = freeParticipants(reader, ids);
	const reference = alignReference(reader, participants);
	if (reference === null) return [];
	const changes: Change[] = [];
	for (const entry of participants) {
		const delta = alignDelta(edge, entry.bounds, reference);
		changes.push(...planMoveBy(reader, entry.id, delta.x, delta.y));
	}
	return changes;
}

// ---------- distribute ----------

function startOf(bounds: Rect, axis: DistributeAxis): number {
	if (axis === 'horizontal') return bounds.x;
	return bounds.y;
}

function sizeOf(bounds: Rect, axis: DistributeAxis): number {
	if (axis === 'horizontal') return bounds.width;
	return bounds.height;
}

function axisMove(axis: DistributeAxis, amount: number): Vec2 {
	if (axis === 'horizontal') return { x: amount, y: 0 };
	return { x: 0, y: amount };
}

/**
 * Equal gaps between at least three nodes: the outermost ones stay, the ones between are spread
 * so every gap equals the free space divided by the number of gaps. Locked nodes take no part.
 */
export function planDistribute(
	reader: DocumentReader,
	ids: readonly NodeId[],
	axis: DistributeAxis
): Change[] {
	const participants = freeParticipants(reader, ids).filter((entry) => !entry.locked);
	if (participants.length < 3) return [];
	participants.sort((left, right) => startOf(left.bounds, axis) - startOf(right.bounds, axis));
	const first = participants[0];
	const last = participants[participants.length - 1];
	const span = startOf(last.bounds, axis) + sizeOf(last.bounds, axis) - startOf(first.bounds, axis);
	const occupied = participants.reduce((sum, entry) => sum + sizeOf(entry.bounds, axis), 0);
	const gap = (span - occupied) / (participants.length - 1);

	const changes: Change[] = [];
	let cursor = startOf(first.bounds, axis) + sizeOf(first.bounds, axis) + gap;
	for (const entry of participants.slice(1, -1)) {
		const move = axisMove(axis, cursor - startOf(entry.bounds, axis));
		changes.push(...planMoveBy(reader, entry.id, move.x, move.y));
		cursor += sizeOf(entry.bounds, axis) + gap;
	}
	return changes;
}

// ---------- tidy up ----------

function overlapsVertically(row: Rect, bounds: Rect): boolean {
	return bounds.y < row.y + row.height && bounds.y + bounds.height > row.y;
}

/** Rows of nodes that overlap vertically, top to bottom, each sorted left to right. */
export function clusterRows(participants: Participant[]): Participant[][] {
	const byTop = [...participants].sort((left, right) => left.bounds.y - right.bounds.y);
	const rows: Participant[][] = [];
	let rowBounds: Rect | null = null;
	for (const entry of byTop) {
		const row = rows.at(-1);
		if (row === undefined || rowBounds === null || !overlapsVertically(rowBounds, entry.bounds)) {
			rows.push([entry]);
			rowBounds = entry.bounds;
			continue;
		}
		row.push(entry);
		rowBounds = unionBounds([rowBounds, entry.bounds]);
	}
	for (const row of rows) row.sort((left, right) => left.bounds.x - right.bounds.x);
	return rows;
}

/**
 * The gap to use for a set of measured gaps: the most common one when some value clearly repeats,
 * else the average. Overlaps (negative gaps) count as zero.
 */
export function uniformGap(gaps: number[]): number {
	if (gaps.length === 0) return 0;
	const clamped = gaps.map((gap) => Math.max(0, gap));
	let best = { value: 0, count: 0 };
	for (const candidate of clamped) {
		const count = clamped.filter((gap) => Math.abs(gap - candidate) <= GAP_TOLERANCE).length;
		if (count > best.count) best = { value: candidate, count };
	}
	if (best.count > 1) return Math.round(best.value * 100) / 100;
	const average = clamped.reduce((sum, gap) => sum + gap, 0) / clamped.length;
	return Math.round(average * 100) / 100;
}

function rowGaps(rows: Participant[][]): number[] {
	const gaps: number[] = [];
	for (const row of rows) {
		for (let position = 1; position < row.length; position += 1) {
			const previous = row[position - 1].bounds;
			gaps.push(row[position].bounds.x - (previous.x + previous.width));
		}
	}
	return gaps;
}

function columnGaps(rows: Participant[][]): number[] {
	const gaps: number[] = [];
	for (let position = 1; position < rows.length; position += 1) {
		const above = unionBounds(rows[position - 1].map((entry) => entry.bounds));
		const below = unionBounds(rows[position].map((entry) => entry.bounds));
		gaps.push(below.y - (above.y + above.height));
	}
	return gaps;
}

/**
 * Snap the selection into a uniform grid: cluster rows by vertical overlap, sort each row by x,
 * space items by the most common (else average) horizontal gap and rows by the same measure of
 * vertical gap. The grid starts at the selection's top-left corner and items align to row tops.
 */
export function planTidyUp(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const participants = freeParticipants(reader, ids).filter((entry) => !entry.locked);
	if (participants.length < 2) return [];
	const rows = clusterRows(participants);
	const origin = unionBounds(participants.map((entry) => entry.bounds));
	const horizontalGap = uniformGap(rowGaps(rows));
	const verticalGap = uniformGap(columnGaps(rows));

	const changes: Change[] = [];
	let rowTop = origin.y;
	for (const row of rows) {
		let cursor = origin.x;
		for (const entry of row) {
			changes.push(
				...planMoveBy(reader, entry.id, cursor - entry.bounds.x, rowTop - entry.bounds.y)
			);
			cursor += entry.bounds.width + horizontalGap;
		}
		const rowHeight = Math.max(...row.map((entry) => entry.bounds.height));
		rowTop += rowHeight + verticalGap;
	}
	return changes;
}
