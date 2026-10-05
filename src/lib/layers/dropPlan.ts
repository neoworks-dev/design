// Layers panel drag and drop, as pure functions: where a pointer position inside the row list
// would put the dragged layers (`resolveDrop`) and the changes that do it (`planLayerDrop`).
// Nothing here applies anything; the layers service applies the plan as one transaction.

import {
	canHaveChildren,
	composeMatrices,
	invertMatrix,
	keysBetween,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId
} from '../document';
import { isPositioned, sortByDocumentOrder, topLevelIds } from '../editing/selectionOps';
import { LAYER_ROW_HEIGHT, type LayerRow } from './tree';

export type DropZone = 'before' | 'after' | 'inside';

/** A slot in the stack of `parentId`: right above the sibling `belowId`, or at the bottom. */
export interface DropDestination {
	parentId: NodeId;
	belowId: NodeId | null;
}

/** What the panel draws: a line between rows at an indent level, or a highlighted row. */
export type DropIndicator =
	{ kind: 'line'; rowBoundary: number; depth: number } | { kind: 'inside'; rowId: NodeId };

export interface ResolvedDrop {
	destination: DropDestination;
	indicator: DropIndicator;
}

const INSIDE_ZONE_START = 0.25;
const INSIDE_ZONE_END = 0.75;

/** The dragged layers that can move: roots of the dragged set that are not instance internals. */
export function draggableIds(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	const roots = topLevelIds(reader, ids).filter((id) => {
		const node = reader.requireNode(id);
		return node.type !== 'PAGE' && node.componentRef === undefined;
	});
	return sortByDocumentOrder(reader, roots);
}

/** Which part of a row the pointer is over; `fraction` is 0 at the row's top edge, 1 at its bottom. */
export function dropZone(node: Node, fraction: number): DropZone {
	if (!canHaveChildren(node.type)) return fraction < 0.5 ? 'before' : 'after';
	if (fraction < INSIDE_ZONE_START) return 'before';
	if (fraction > INSIDE_ZONE_END) return 'after';
	return 'inside';
}

export function rowIndexAt(contentY: number, rowCount: number): number {
	return Math.max(0, Math.min(rowCount, Math.floor(contentY / LAYER_ROW_HEIGHT)));
}

export function fractionInRow(contentY: number): number {
	const position = contentY / LAYER_ROW_HEIGHT;
	return position - Math.floor(position);
}

function isInside(reader: DocumentReader, parentId: NodeId, dragged: readonly NodeId[]): boolean {
	if (dragged.includes(parentId)) return true;
	return reader.ancestors(parentId).some((ancestor) => dragged.includes(ancestor.id));
}

function storedBelow(reader: DocumentReader, id: NodeId): NodeId | null {
	const node = reader.requireNode(id);
	const siblings = reader.children(node.parentId);
	const position = siblings.indexOf(id);
	if (position <= 0) return null;
	return siblings[position - 1];
}

function topChild(reader: DocumentReader, parentId: NodeId): NodeId | null {
	return reader.children(parentId).at(-1) ?? null;
}

/** True when `id` is the bottom-most child of its parent, so a line below it can climb a level. */
function isBottomChild(reader: DocumentReader, id: NodeId): boolean {
	const node = reader.requireNode(id);
	return reader.children(node.parentId)[0] === id;
}

/**
 * The drop a pointer at `rowIndex` / `zone` means. For a line below the last row of a nested
 * container, `pointerDepth` (the indent level under the pointer) climbs out of it. `null` when
 * the drop is not allowed: into a dragged layer or its descendants, or into a layer that cannot
 * have children.
 */
export function resolveDrop(
	reader: DocumentReader,
	rows: readonly LayerRow[],
	rootId: NodeId,
	rowIndex: number,
	zone: DropZone,
	pointerDepth: number,
	dragged: readonly NodeId[]
): ResolvedDrop | null {
	const resolved = locate(reader, rows, rootId, rowIndex, zone, pointerDepth);
	if (resolved === null) return null;
	const parent = reader.requireNode(resolved.destination.parentId);
	if (!canHaveChildren(parent.type)) return null;
	if (isInside(reader, parent.id, dragged)) return null;
	return resolved;
}

function locate(
	reader: DocumentReader,
	rows: readonly LayerRow[],
	rootId: NodeId,
	rowIndex: number,
	zone: DropZone,
	pointerDepth: number
): ResolvedDrop | null {
	if (rows.length === 0) {
		return line({ parentId: rootId, belowId: null }, 0, 0);
	}
	if (rowIndex >= rows.length) return belowLastRow(reader, rows, rootId, pointerDepth);
	const row = rows[rowIndex];
	if (zone === 'inside') {
		const destination = { parentId: row.id, belowId: topChild(reader, row.id) };
		return { destination, indicator: { kind: 'inside', rowId: row.id } };
	}
	if (zone === 'before') {
		const parentId = reader.requireNode(row.id).parentId;
		if (parentId === null) return null;
		return line({ parentId, belowId: row.id }, rowIndex, row.depth);
	}
	return afterRow(reader, rows, rowIndex, pointerDepth);
}

function line(destination: DropDestination, rowBoundary: number, depth: number): ResolvedDrop {
	return { destination, indicator: { kind: 'line', rowBoundary, depth } };
}

function afterRow(
	reader: DocumentReader,
	rows: readonly LayerRow[],
	rowIndex: number,
	pointerDepth: number
): ResolvedDrop | null {
	const row = rows[rowIndex];
	if (row.expanded) {
		const destination = { parentId: row.id, belowId: topChild(reader, row.id) };
		return line(destination, rowIndex + 1, row.depth + 1);
	}
	return climbingLine(reader, row, rowIndex + 1, pointerDepth);
}

/** A line below `row`; nested rows at the bottom of their container may leave it by indent. */
function climbingLine(
	reader: DocumentReader,
	row: LayerRow,
	rowBoundary: number,
	pointerDepth: number
): ResolvedDrop | null {
	let current = row.id;
	let depth = row.depth;
	while (depth > pointerDepth && isBottomChild(reader, current)) {
		const parent = reader.requireNode(current).parentId;
		if (parent === null || reader.requireNode(parent).type === 'PAGE') break;
		current = parent;
		depth -= 1;
	}
	const parentId = reader.requireNode(current).parentId;
	if (parentId === null) return null;
	return line({ parentId, belowId: storedBelow(reader, current) }, rowBoundary, depth);
}

function belowLastRow(
	reader: DocumentReader,
	rows: readonly LayerRow[],
	rootId: NodeId,
	pointerDepth: number
): ResolvedDrop | null {
	const last = rows[rows.length - 1];
	if (last.expanded) {
		const destination = { parentId: last.id, belowId: topChild(reader, last.id) };
		return line(destination, rows.length, last.depth + 1);
	}
	const climbed = climbingLine(reader, last, rows.length, pointerDepth);
	if (climbed !== null) return climbed;
	return line({ parentId: rootId, belowId: null }, rows.length, 0);
}

// ---------- the plan ----------

function absoluteToLocal(
	reader: DocumentReader,
	node: Node,
	parentId: NodeId
): Matrix2x3 | undefined {
	if (!isPositioned(node)) return undefined;
	const inverse = invertMatrix(reader.cache.absoluteTransform(parentId));
	if (inverse === null) return undefined;
	return composeMatrices(inverse, reader.cache.absoluteTransform(node.id));
}

/** Nearest sibling at or below `belowId` that is not itself being moved. */
function lowerNeighbour(
	siblings: readonly Node[],
	belowId: NodeId | null,
	dragged: ReadonlySet<NodeId>
): Node | null {
	if (belowId === null) return null;
	let position = siblings.findIndex((sibling) => sibling.id === belowId);
	while (position >= 0 && dragged.has(siblings[position].id)) position -= 1;
	if (position < 0) return null;
	return siblings[position];
}

function upperNeighbour(
	siblings: readonly Node[],
	lower: Node | null,
	dragged: ReadonlySet<NodeId>
): Node | null {
	let position = 0;
	if (lower !== null) position = siblings.findIndex((sibling) => sibling.id === lower.id) + 1;
	for (; position < siblings.length; position += 1) {
		if (!dragged.has(siblings[position].id)) return siblings[position];
	}
	return null;
}

function alreadyThere(
	siblings: readonly Node[],
	run: readonly NodeId[],
	lower: Node | null,
	upper: Node | null
): boolean {
	const between = siblings
		.filter((sibling) => lower === null || sibling.index > lower.index)
		.filter((sibling) => upper === null || sibling.index < upper.index)
		.map((sibling) => sibling.id);
	return between.length === run.length && between.every((id, position) => id === run[position]);
}

/**
 * Move `dragged` (bottom-most first, as `draggableIds` returns them) to `destination`, keeping
 * their relative stacking and, when the parent changes, their absolute position. Returns no
 * changes when the layers already sit there, and `null` when the drop is invalid.
 */
export function planLayerDrop(
	reader: DocumentReader,
	dragged: readonly NodeId[],
	destination: DropDestination
): Change[] | null {
	if (dragged.length === 0) return null;
	const parent = reader.requireNode(destination.parentId);
	if (!canHaveChildren(parent.type)) return null;
	if (isInside(reader, parent.id, dragged)) return null;
	const moving = new Set(dragged);
	const siblings = reader.childNodes(parent.id);
	const lower = lowerNeighbour(siblings, destination.belowId, moving);
	const upper = upperNeighbour(siblings, lower, moving);
	if (alreadyThere(siblings, dragged, lower, upper)) return [];
	const keys = keysBetween(
		lower === null ? null : lower.index,
		upper === null ? null : upper.index,
		dragged.length
	);
	return dragged.flatMap((id, position) => moveChanges(reader, id, parent.id, keys[position]));
}

function moveChanges(
	reader: DocumentReader,
	id: NodeId,
	parentId: NodeId,
	index: string
): Change[] {
	const node = reader.requireNode(id);
	const changes: Change[] = [
		{ t: 'move', id, parent: parentId, index, prevParent: node.parentId, prevIndex: node.index }
	];
	if (node.parentId === parentId) return changes;
	const transform = absoluteToLocal(reader, node, parentId);
	if (transform === undefined) return changes;
	changes.push({
		t: 'set',
		id,
		set: { transform },
		prev: { transform: Reflect.get(node, 'transform') }
	});
	return changes;
}
