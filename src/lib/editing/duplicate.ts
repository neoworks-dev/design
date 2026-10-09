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
	type Rect,
	type Vec2
} from '../document';
import { centringShift, pushRightOfSiblings, rectsIntersect } from './placement';
import {
	isAutoLayoutChild,
	isPositioned,
	sortByDocumentOrder,
	topLevelIds,
	unionBounds
} from './selectionOps';
import { parentDelta, translated } from './nudge';

export interface DuplicatePlan {
	changes: Change[];
	/** The new top-level nodes, in z-order, for the selection to adopt. */
	cloneIds: NodeId[];
	/** Absolute bounds of the clones, for the view to follow. */
	placedBounds: Rect | null;
	/** How far Figma-style placement (centring, pushing) moved the clones; zero for plain offsets. */
	placementShift: Vec2;
	/** The clones were moved, so the view brings all of them on screen (Figma's pan-just-enough). */
	moved: boolean;
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
	const origin = originOf(reader, sourceIds[0]);
	return {
		cloneIds: plan.cloneIds,
		sourceOrigin: { x: origin.x + plan.placementShift.x, y: origin.y + plan.placementShift.y }
	};
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

function isPushedFrame(reader: DocumentReader, id: NodeId): boolean {
	const node = reader.requireNode(id);
	if (node.type !== 'FRAME' || node.parentId === null) return false;
	return reader.requireNode(node.parentId).type === 'PAGE';
}

/**
 * Where a lone duplicate goes in Figma: centred in the view when the original is out of view
 * (any node), and a top-level frame is also pushed right of whatever it would overlap (gap 40).
 * `null` when the duplicate follows the plain offset instead.
 */
export function singleDuplicateShift(
	reader: DocumentReader,
	sourceIds: readonly NodeId[],
	viewport: Rect | null
): Vec2 | null {
	if (viewport === null || sourceIds.length !== 1) return null;
	const [id] = sourceIds;
	const bounds = reader.cache.absoluteBounds(id);
	let moved = bounds;
	if (!rectsIntersect(bounds, viewport)) {
		const centring = centringShift(viewport, bounds);
		moved = { ...bounds, x: bounds.x + centring.x, y: bounds.y + centring.y };
	}
	const parentId = reader.requireNode(id).parentId;
	if (parentId !== null && isPushedFrame(reader, id)) {
		moved = pushRightOfSiblings(reader, parentId, moved);
	}
	return { x: moved.x - bounds.x, y: moved.y - bounds.y };
}

/**
 * Clone the selection `offset` screen pixels away from the originals; with a `viewport`, a lone
 * node is placed like Figma places it (see `singleDuplicateShift`).
 */
export function planDuplicate(
	reader: DocumentReader,
	ids: readonly NodeId[],
	offset: Vec2 = NO_OFFSET,
	viewport: Rect | null = null
): DuplicatePlan {
	const plan: DuplicatePlan = {
		changes: [],
		cloneIds: [],
		placedBounds: null,
		placementShift: NO_OFFSET,
		moved: false
	};
	const sources = duplicableIds(reader, ids);
	const shift = singleDuplicateShift(reader, sources, viewport);
	const effective = shift === null ? offset : shift;
	for (const id of sources) {
		const original = reader.requireNode(id);
		const clone = cloneSubtree(reader, id);
		moveClone(reader, original, clone.nodes[0], effective);
		plan.changes.push(...clone.changes);
		plan.cloneIds.push(clone.rootId);
	}
	if (sources.length === 0) return plan;
	if (shift !== null) plan.placementShift = shift;
	plan.moved = effective.x !== 0 || effective.y !== 0;
	const bounds = unionBounds(sources.map((id) => reader.cache.absoluteBounds(id)));
	plan.placedBounds = { ...bounds, x: bounds.x + effective.x, y: bounds.y + effective.y };
	return plan;
}
