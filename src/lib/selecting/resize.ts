// Resize math for the transform handles. Pure: no Svelte, no kernel. Docs:
// docs/research/interactions.md section 4.
//
// A resize is described in a "frame space" with its origin at the top left of the box being
// resized: the node's own local space for one node (so rotated nodes resize along their own
// axes), world space for several nodes. `resizeBox` turns a handle drag into the new box inside
// that space; `ResizeSession` applies it to the document nodes.
//
//   Shift  keep the aspect ratio (the node's own proportion lock does the same)
//   Alt    scale about the centre instead of the opposite edge
//   Ctrl   frames do not apply their children's constraints
//
// Dragging a handle through the opposite edge flips the node (negative determinant). The size
// never drops below MIN_SIZE on an axis that is being dragged.

import {
	composeMatrices,
	invertMatrix,
	isFrameLike,
	planSetProps,
	transformedBounds,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Rect
} from '../document';
import {
	isPositioned,
	topLevelIds,
	unionBounds,
	type PositionedNode
} from '../editing/selectionOps';
import type { Point } from '../tools/protocol';

export const MIN_SIZE = 0.01;

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where a handle sits on the box, as a fraction of its width and height. */
export const HANDLE_POSITION: Record<HandleId, { u: number; v: number }> = {
	nw: { u: 0, v: 0 },
	n: { u: 0.5, v: 0 },
	ne: { u: 1, v: 0 },
	e: { u: 1, v: 0.5 },
	se: { u: 1, v: 1 },
	s: { u: 0.5, v: 1 },
	sw: { u: 0, v: 1 },
	w: { u: 0, v: 0.5 }
};

export interface ResizeModifiers {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface BoxSize {
	width: number;
	height: number;
}

export interface BoxResize extends BoxSize {
	/** Where the new box's top left lies, in the old box's frame space (before any flip). */
	originX: number;
	originY: number;
	flipX: boolean;
	flipY: boolean;
}

function signOf(value: number): number {
	if (value < 0) return -1;
	return 1;
}

function clampSigned(value: number): number {
	if (Math.abs(value) >= MIN_SIZE) return value;
	return MIN_SIZE * signOf(value);
}

interface Axis {
	/** Handle position on this axis: 0, 0.5 or 1. */
	handle: number;
	/** Anchor position on this axis: the part of the box that does not move. */
	anchor: number;
	size: number;
	moves: boolean;
}

/** New signed size along one axis for a pointer offset `offset`. */
function signedSize(axis: Axis, offset: number): number {
	if (!axis.moves) return axis.size;
	const pointer = axis.handle * axis.size + offset;
	return (pointer - axis.anchor * axis.size) / (axis.handle - axis.anchor);
}

function ratioOf(signed: number, size: number): number {
	if (size === 0) return 1;
	return signed / size;
}

export function resizeBox(
	size: BoxSize,
	handleId: HandleId,
	delta: Point,
	modifiers: ResizeModifiers,
	lockProportions: boolean = false
): BoxResize {
	const position = HANDLE_POSITION[handleId];
	const horizontal: Axis = {
		handle: position.u,
		anchor: modifiers.altKey ? 0.5 : 1 - position.u,
		size: size.width,
		moves: position.u !== 0.5
	};
	const vertical: Axis = {
		handle: position.v,
		anchor: modifiers.altKey ? 0.5 : 1 - position.v,
		size: size.height,
		moves: position.v !== 0.5
	};
	let signedWidth = signedSize(horizontal, delta.x);
	let signedHeight = signedSize(vertical, delta.y);
	if (modifiers.shiftKey || lockProportions) {
		const scaled = keepProportions(horizontal, vertical, signedWidth, signedHeight);
		signedWidth = scaled.width;
		signedHeight = scaled.height;
	}
	if (horizontal.moves) signedWidth = clampSigned(signedWidth);
	if (vertical.moves) signedHeight = clampSigned(signedHeight);
	return {
		width: Math.abs(signedWidth),
		height: Math.abs(signedHeight),
		originX: horizontal.anchor * (size.width - signedWidth),
		originY: vertical.anchor * (size.height - signedHeight),
		flipX: signedWidth < 0,
		flipY: signedHeight < 0
	};
}

/**
 * Corner: the larger of the two scale factors wins, each axis keeps its own direction. Edge: the
 * other axis follows with the same factor, about its centre.
 */
function keepProportions(
	horizontal: Axis,
	vertical: Axis,
	signedWidth: number,
	signedHeight: number
): { width: number; height: number } {
	const ratioX = ratioOf(signedWidth, horizontal.size);
	const ratioY = ratioOf(signedHeight, vertical.size);
	if (horizontal.moves && vertical.moves) {
		const ratio = Math.max(Math.abs(ratioX), Math.abs(ratioY));
		return {
			width: horizontal.size * ratio * signOf(ratioX),
			height: vertical.size * ratio * signOf(ratioY)
		};
	}
	if (horizontal.moves) {
		return { width: signedWidth, height: vertical.size * Math.abs(ratioX) };
	}
	return { width: horizontal.size * Math.abs(ratioY), height: signedHeight };
}

/** The affine map from the resized node's new local space to its old local space. */
function boxAffine(box: BoxResize): Matrix2x3 {
	let scaleX = 1;
	if (box.flipX) scaleX = -1;
	let scaleY = 1;
	if (box.flipY) scaleY = -1;
	return [
		[scaleX, 0, box.originX],
		[0, scaleY, box.originY]
	];
}

export interface ScaledTransform {
	transform: Matrix2x3;
	width: number;
	height: number;
}

/**
 * Scale a node by the axis-aligned map `p -> (kx * p.x + tx, ky * p.y + ty)` applied to its
 * parent's space. Exact for axis-aligned nodes (a negative factor mirrors them); a rotated node
 * keeps its rotation, its centre moves with the map and its sides scale by the stretched
 * length of its axes (skew is not representable in a node transform).
 */
export function scaleTransform(
	transform: Matrix2x3,
	width: number,
	height: number,
	factors: { kx: number; ky: number; tx: number; ty: number }
): ScaledTransform {
	const [[a, c, e], [b, d, f]] = transform;
	const { kx, ky, tx, ty } = factors;
	const xAxis = { x: kx * a, y: ky * b };
	const yAxis = { x: kx * c, y: ky * d };
	const xLength = Math.hypot(xAxis.x, xAxis.y);
	const yLength = Math.hypot(yAxis.x, yAxis.y);
	if (xLength === 0 || yLength === 0) return { transform, width, height };
	const newWidth = width * xLength;
	const newHeight = height * yLength;
	const centreX = a * (width / 2) + c * (height / 2) + e;
	const centreY = b * (width / 2) + d * (height / 2) + f;
	const newCentreX = kx * centreX + tx;
	const newCentreY = ky * centreY + ty;
	const xUnit = { x: xAxis.x / xLength, y: xAxis.y / xLength };
	const yUnit = { x: yAxis.x / yLength, y: yAxis.y / yLength };
	return {
		transform: [
			[xUnit.x, yUnit.x, newCentreX - xUnit.x * (newWidth / 2) - yUnit.x * (newHeight / 2)],
			[xUnit.y, yUnit.y, newCentreY - xUnit.y * (newWidth / 2) - yUnit.y * (newHeight / 2)]
		],
		width: newWidth,
		height: newHeight
	};
}

type Constraint = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';

/** The 1-D map (scale and offset) that a child's span `[start, end]` goes through. */
function constrainSpan(
	constraint: Constraint,
	span: { start: number; end: number },
	oldSize: number,
	newSize: number
): { k: number; t: number } {
	const growth = newSize - oldSize;
	const length = span.end - span.start;
	let start = span.start;
	let end = span.end;
	if (constraint === 'MAX') {
		start += growth;
		end += growth;
	} else if (constraint === 'CENTER') {
		start += growth / 2;
		end += growth / 2;
	} else if (constraint === 'STRETCH') {
		end += growth;
	} else if (constraint === 'SCALE') {
		const ratio = ratioOf(newSize, oldSize);
		start *= ratio;
		end *= ratio;
	}
	if (length <= 0) return { k: 1, t: start - span.start };
	const k = (end - start) / length;
	return { k, t: start - span.start * k };
}

export interface ResizePlan {
	changes: Change[];
	/** The size of the whole selection after the resize, for the size readout. */
	size: BoxSize;
}

export interface ResizeRequest {
	handle: HandleId;
	/** Pointer movement since the press, in world units. */
	delta: Point;
	modifiers: ResizeModifiers;
}

const GROUP_LIKE: readonly string[] = ['GROUP', 'BOOLEAN_OPERATION'];

/**
 * A resize gesture over a fixed set of nodes. The constructor snapshots the nodes (and the
 * subtrees that scale with them) as they are when the gesture starts; `plan` always computes
 * from that snapshot, so replanning on every pointer move never accumulates error, and returns
 * the changes that turn the *current* document into the target.
 */
export class ResizeSession {
	readonly rootIds: NodeId[];
	private readonly initial = new Map<NodeId, PositionedNode>();
	private readonly initialAbsolute = new Map<NodeId, Matrix2x3>();
	private readonly childIds = new Map<NodeId, NodeId[]>();

	constructor(
		private readonly reader: DocumentReader,
		ids: readonly NodeId[]
	) {
		this.rootIds = topLevelIds(reader, ids).filter((id) => {
			const node = reader.requireNode(id);
			return isPositioned(node) && !node.locked;
		});
		for (const id of this.rootIds) this.capture(id);
	}

	get isEmpty(): boolean {
		return this.rootIds.length === 0;
	}

	/** True when the single node is rotated or sheared, so axis-aligned snapping would lie. */
	get isRotated(): boolean {
		if (this.rootIds.length !== 1) return false;
		const [[a, c], [b, d]] = this.absoluteOf(this.rootIds[0]);
		return Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || a === 0 || d === 0;
	}

	/** Absolute bounds of the selection when the gesture started. */
	get startBounds(): Rect {
		return unionBounds(this.rootIds.map((id) => this.startBoundsOf(id)));
	}

	plan(request: ResizeRequest): ResizePlan {
		if (this.rootIds.length === 1) return this.planSingle(request);
		return this.planMultiple(request);
	}

	private capture(id: NodeId): void {
		const node = this.reader.requireNode(id);
		if (!isPositioned(node)) return;
		this.initial.set(id, { ...node });
		this.initialAbsolute.set(id, this.reader.cache.absoluteTransform(id));
		const kids = [...this.reader.children(id)];
		this.childIds.set(id, kids);
		for (const kidId of kids) this.capture(kidId);
	}

	private nodeOf(id: NodeId): PositionedNode {
		const node = this.initial.get(id);
		if (!node) throw new Error(`resize session has no node ${id}`);
		return node;
	}

	private absoluteOf(id: NodeId): Matrix2x3 {
		const absolute = this.initialAbsolute.get(id);
		if (!absolute) throw new Error(`resize session has no node ${id}`);
		return absolute;
	}

	private startBoundsOf(id: NodeId): Rect {
		const node = this.nodeOf(id);
		return transformedBounds(this.absoluteOf(id), node.width, node.height);
	}

	// ---------- one node: resize along its own axes ----------

	private planSingle(request: ResizeRequest): ResizePlan {
		const id = this.rootIds[0];
		const node = this.nodeOf(id);
		const linear = this.absoluteOf(id);
		const inverse = invertMatrix([
			[linear[0][0], linear[0][1], 0],
			[linear[1][0], linear[1][1], 0]
		]);
		let local = request.delta;
		if (inverse !== null) {
			local = {
				x: inverse[0][0] * request.delta.x + inverse[0][1] * request.delta.y,
				y: inverse[1][0] * request.delta.x + inverse[1][1] * request.delta.y
			};
		}
		const box = resizeBox(
			{ width: node.width, height: node.height },
			request.handle,
			local,
			request.modifiers,
			node.constrainProportions
		);
		const transform = composeMatrices(node.transform, boxAffine(box));
		const edits = new Map<NodeId, Record<string, unknown>>();
		this.resizeSubtree(id, transform, box.width, box.height, request, edits);
		this.applyRootRules(node, box, request.handle, edits);
		return { changes: this.toChanges(edits), size: { width: box.width, height: box.height } };
	}

	// ---------- several nodes: scale the combined bounds ----------

	private planMultiple(request: ResizeRequest): ResizePlan {
		const bounds = this.startBounds;
		const box = resizeBox(
			{ width: bounds.width, height: bounds.height },
			request.handle,
			request.delta,
			request.modifiers
		);
		const kx = ratioOf(box.width, bounds.width) * (box.flipX ? -1 : 1);
		const ky = ratioOf(box.height, bounds.height) * (box.flipY ? -1 : 1);
		const factors = {
			kx,
			ky,
			tx: bounds.x + box.originX - kx * bounds.x,
			ty: bounds.y + box.originY - ky * bounds.y
		};
		const edits = new Map<NodeId, Record<string, unknown>>();
		for (const id of this.rootIds) {
			const node = this.nodeOf(id);
			const scaled = scaleTransform(this.absoluteOf(id), node.width, node.height, factors);
			const transform = this.toParentSpace(node, scaled.transform);
			this.resizeSubtree(id, transform, scaled.width, scaled.height, request, edits);
			this.applyRootRules(node, box, request.handle, edits);
		}
		return { changes: this.toChanges(edits), size: { width: box.width, height: box.height } };
	}

	private toParentSpace(node: PositionedNode, absolute: Matrix2x3): Matrix2x3 {
		if (node.parentId === null) return absolute;
		const parent = this.reader.requireNode(node.parentId);
		if (parent.type === 'PAGE') return absolute;
		const inverse = invertMatrix(this.reader.cache.absoluteTransform(node.parentId));
		if (inverse === null) return absolute;
		return composeMatrices(inverse, absolute);
	}

	// ---------- subtrees ----------

	private resizeSubtree(
		id: NodeId,
		transform: Matrix2x3,
		width: number,
		height: number,
		request: ResizeRequest,
		edits: Map<NodeId, Record<string, unknown>>
	): void {
		const node = this.nodeOf(id);
		edits.set(id, { ...edits.get(id), transform, width, height });
		const kids = this.childIds.get(id);
		if (kids === undefined) return;
		const scaleX = ratioOf(width, node.width);
		const scaleY = ratioOf(height, node.height);
		const constrained =
			isFrameLike(node) && !(request.modifiers.ctrlKey || request.modifiers.metaKey);
		for (const kidId of kids) {
			const kid = this.nodeOf(kidId);
			if (constrained) {
				this.resizeConstrained(kid, node, { width, height }, request, edits);
			} else if (GROUP_LIKE.includes(node.type)) {
				const factors = { kx: scaleX, ky: scaleY, tx: 0, ty: 0 };
				const scaled = scaleTransform(kid.transform, kid.width, kid.height, factors);
				this.resizeSubtree(kidId, scaled.transform, scaled.width, scaled.height, request, edits);
			}
		}
	}

	private resizeConstrained(
		kid: PositionedNode,
		parent: PositionedNode,
		parentSize: BoxSize,
		request: ResizeRequest,
		edits: Map<NodeId, Record<string, unknown>>
	): void {
		if (parent.width === parentSize.width && parent.height === parentSize.height) return;
		const bounds = transformedBounds(kid.transform, kid.width, kid.height);
		const constraints = constraintsOf(kid);
		const horizontal = constrainSpan(
			constraints.horizontal,
			{ start: bounds.x, end: bounds.x + bounds.width },
			parent.width,
			parentSize.width
		);
		const vertical = constrainSpan(
			constraints.vertical,
			{ start: bounds.y, end: bounds.y + bounds.height },
			parent.height,
			parentSize.height
		);
		const scaled = scaleTransform(kid.transform, kid.width, kid.height, {
			kx: horizontal.k,
			ky: vertical.k,
			tx: horizontal.t,
			ty: vertical.t
		});
		this.resizeSubtree(kid.id, scaled.transform, scaled.width, scaled.height, request, edits);
	}

	// ---------- rules for the node being resized ----------

	/** Text switches its auto resize mode, auto layout sizing becomes fixed on a resized axis. */
	private applyRootRules(
		node: PositionedNode,
		box: BoxSize,
		handle: HandleId,
		edits: Map<NodeId, Record<string, unknown>>
	): void {
		const extra: Record<string, unknown> = {};
		if (node.type === 'TEXT') extra.textAutoResize = textModeFor(handle);
		const position = HANDLE_POSITION[handle];
		const widthChanged = position.u !== 0.5 && Math.abs(box.width - node.width) > 1e-9;
		const heightChanged = position.v !== 0.5 && Math.abs(box.height - node.height) > 1e-9;
		if (widthChanged && node.layoutSizingHorizontal !== 'FIXED') {
			extra.layoutSizingHorizontal = 'FIXED';
		}
		if (heightChanged && node.layoutSizingVertical !== 'FIXED') {
			extra.layoutSizingVertical = 'FIXED';
		}
		edits.set(node.id, { ...edits.get(node.id), ...extra });
	}

	private toChanges(edits: Map<NodeId, Record<string, unknown>>): Change[] {
		const changes: Change[] = [];
		for (const [id, props] of edits) changes.push(...planSetProps(this.reader, id, props));
		return changes;
	}
}

/**
 * Side handles make a text box auto height (`HEIGHT`) when they move its width; every other
 * handle fixes the size (`NONE`).
 */
export function textModeFor(handle: HandleId): 'NONE' | 'HEIGHT' {
	if (handle === 'e' || handle === 'w') return 'HEIGHT';
	return 'NONE';
}

const DEFAULT_CONSTRAINTS: { horizontal: Constraint; vertical: Constraint } = {
	horizontal: 'MIN',
	vertical: 'MIN'
};

function constraintsOf(node: Node): { horizontal: Constraint; vertical: Constraint } {
	if (!('constraints' in node)) return DEFAULT_CONSTRAINTS;
	return node.constraints;
}
