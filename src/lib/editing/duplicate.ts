// Planning for duplicate (Ctrl+D). Clones go right after their originals among the siblings, so an
// auto layout child's copy lands after it in the flow. A component duplicates into a new component
// (cloneSubtree gives it its own key); an instance stays linked to the same main component.
// Repeating the offset: the plugin remembers where the last duplicate came from, and when the
// selection is still that duplicate, the distance the user moved it since is applied again.

import {
	cloneSubtree,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type Vec2
} from '../document';
import { isAutoLayoutChild, isPositioned, sortByDocumentOrder, topLevelIds } from './selectionOps';
import { parentDelta, translated } from './nudge';

export interface DuplicatePlan {
	changes: Change[];
	/** The new top-level nodes, in z-order, for the selection to adopt. */
	cloneIds: NodeId[];
}

/** What the last duplicate did, kept to repeat its offset. */
export interface DuplicateMemory {
	cloneIds: NodeId[];
	/** Absolute top-left of the first source node when it was duplicated. */
	sourceOrigin: Vec2;
}

const NO_OFFSET: Vec2 = { x: 0, y: 0 };

function originOf(reader: DocumentReader, id: NodeId): Vec2 {
	const bounds = reader.cache.absoluteBounds(id);
	return { x: bounds.x, y: bounds.y };
}

function sameIds(left: readonly NodeId[], right: readonly NodeId[]): boolean {
	if (left.length !== right.length) return false;
	const known = new Set(left);
	return right.every((id) => known.has(id));
}

/**
 * The offset the next duplicate gets: zero the first time, afterwards the distance the previous
 * duplicate was moved from where it was created, as long as it is still the selection.
 */
export function repeatOffset(
	reader: DocumentReader,
	memory: DuplicateMemory | null,
	selection: readonly NodeId[]
): Vec2 {
	if (memory === null) return NO_OFFSET;
	if (!sameIds(memory.cloneIds, selection)) return NO_OFFSET;
	if (!reader.hasNode(memory.cloneIds[0])) return NO_OFFSET;
	const current = originOf(reader, memory.cloneIds[0]);
	return { x: current.x - memory.sourceOrigin.x, y: current.y - memory.sourceOrigin.y };
}

/** The memory to keep after duplicating `sourceIds` into `plan`. */
export function rememberDuplicate(
	reader: DocumentReader,
	sourceIds: readonly NodeId[],
	plan: DuplicatePlan
): DuplicateMemory {
	return { cloneIds: plan.cloneIds, sourceOrigin: originOf(reader, sourceIds[0]) };
}

function moveClone(reader: DocumentReader, original: Node, clone: Node, offset: Vec2): void {
	if (offset.x === 0 && offset.y === 0) return;
	if (!isPositioned(original) || !isPositioned(clone)) return;
	if (isAutoLayoutChild(reader, original)) return;
	const delta = parentDelta(reader, original, offset.x, offset.y);
	clone.transform = translated(original.transform, delta.x, delta.y);
}

/** Top-level selected nodes in z-order that can be duplicated (everything except pages). */
export function duplicableIds(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	const sorted = sortByDocumentOrder(reader, topLevelIds(reader, ids));
	return sorted.filter((id) => reader.requireNode(id).parentId !== null);
}

/** Clone the selection `offset` screen pixels away from the originals. */
export function planDuplicate(
	reader: DocumentReader,
	ids: readonly NodeId[],
	offset: Vec2 = NO_OFFSET
): DuplicatePlan {
	const plan: DuplicatePlan = { changes: [], cloneIds: [] };
	for (const id of duplicableIds(reader, ids)) {
		const original = reader.requireNode(id);
		const clone = cloneSubtree(reader, id);
		moveClone(reader, original, clone.nodes[0], offset);
		plan.changes.push(...clone.changes);
		plan.cloneIds.push(clone.rootId);
	}
	return plan;
}
