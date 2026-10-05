// Constraints engine: when a frame that does not lay out its children is resized, every child
// follows its horizontal and vertical constraint. Pure; the `constraints` plugin calls it from the
// `document/append` step so the child changes join the resizing transaction (data-model.md
// section 5). Docs: docs/research/interactions.md section 4.
//
// Children that the same transaction already moved (the resize handles plan their own, and the
// Scale tool scales them) are left alone, so nothing is applied twice. A resized child that is
// itself a frame disturbs its own children, which the append loop picks up in the next round.

import {
	isFrameLike,
	planSetProps,
	transformedBounds,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId
} from '../document';
import { constrainSpan, scaleTransform, type Constraint } from '../selecting/resize';

const GEOMETRY_KEYS: readonly string[] = ['transform', 'width', 'height'];
const TOLERANCE = 0.0001;

interface Size {
	width: number;
	height: number;
}

function hasGeometryKey(props: Record<string, unknown>): boolean {
	return GEOMETRY_KEYS.some((key) => key in props);
}

/** Frames whose size one of `changes` set, with the size they had before the first such change. */
function resizedFrames(reader: DocumentReader, changes: readonly Change[]): Map<NodeId, Size> {
	const frames = new Map<NodeId, Size>();
	for (const change of changes) {
		if (change.t !== 'set' || frames.has(change.id)) continue;
		if (!('width' in change.set) && !('height' in change.set)) continue;
		const node = reader.getNode(change.id);
		if (node === undefined || node.type === 'PAGE' || !isFrameLike(node)) continue;
		const previous = change.prev;
		let width = node.width;
		let height = node.height;
		if (typeof previous.width === 'number') width = previous.width;
		if (typeof previous.height === 'number') height = previous.height;
		frames.set(change.id, { width, height });
	}
	return frames;
}

/** Ids whose geometry the same batch already decided, or that did not exist before it. */
function settledIds(changes: readonly Change[]): Set<NodeId> {
	const ids = new Set<NodeId>();
	for (const change of changes) {
		if (change.t === 'add') ids.add(change.node.id);
		if (change.t === 'set' && hasGeometryKey(change.set)) ids.add(change.id);
	}
	return ids;
}

/** A frame with auto layout positions its children itself, so constraints do not apply. */
function appliesConstraints(frame: Node): boolean {
	if (!isFrameLike(frame)) return false;
	if (!('layoutMode' in frame)) return true;
	return frame.layoutMode === 'NONE';
}

function constraintsOf(child: Node): { horizontal: Constraint; vertical: Constraint } {
	if (!('constraints' in child)) return { horizontal: 'MIN', vertical: 'MIN' };
	return child.constraints;
}

function differs(left: number, right: number): boolean {
	return Math.abs(left - right) > TOLERANCE;
}

function planChild(reader: DocumentReader, child: Node, oldSize: Size, newSize: Size): Change[] {
	if (child.type === 'PAGE') return [];
	const bounds = transformedBounds(child.transform, child.width, child.height);
	const constraints = constraintsOf(child);
	const horizontal = constrainSpan(
		constraints.horizontal,
		{ start: bounds.x, end: bounds.x + bounds.width },
		oldSize.width,
		newSize.width
	);
	const vertical = constrainSpan(
		constraints.vertical,
		{ start: bounds.y, end: bounds.y + bounds.height },
		oldSize.height,
		newSize.height
	);
	const scaled = scaleTransform(child.transform, child.width, child.height, {
		kx: horizontal.k,
		ky: vertical.k,
		tx: horizontal.t,
		ty: vertical.t
	});
	const props: Record<string, unknown> = {};
	if (differs(scaled.width, child.width)) props.width = scaled.width;
	if (differs(scaled.height, child.height)) props.height = scaled.height;
	const before = child.transform;
	const after = scaled.transform;
	const moved =
		differs(before[0][2], after[0][2]) ||
		differs(before[1][2], after[1][2]) ||
		differs(before[0][0], after[0][0]) ||
		differs(before[1][1], after[1][1]);
	if (moved) props.transform = after;
	return planSetProps(reader, child.id, props);
}

/**
 * Changes that make the children of every frame `changes` resized follow their constraints.
 * `children` lists a frame's children in the store the changes were applied to.
 */
export function planConstraints(
	reader: DocumentReader,
	children: (id: NodeId) => readonly Node[],
	changes: readonly Change[]
): Change[] {
	const planned: Change[] = [];
	const settled = settledIds(changes);
	for (const [frameId, oldSize] of resizedFrames(reader, changes)) {
		const frame = reader.requireNode(frameId);
		if (frame.type === 'PAGE' || !appliesConstraints(frame)) continue;
		const newSize = { width: frame.width, height: frame.height };
		if (!differs(oldSize.width, newSize.width) && !differs(oldSize.height, newSize.height)) {
			continue;
		}
		for (const child of children(frameId)) {
			if (settled.has(child.id)) continue;
			planned.push(...planChild(reader, child, oldSize, newSize));
		}
	}
	return planned;
}
