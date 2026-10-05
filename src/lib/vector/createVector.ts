// Turning a finished network into document changes, shared by the pen and the pencil: a new
// VECTOR node in the container under the first point, or the update of an existing one. Both are
// ONE change set through `document.apply` (one undo step).

import type { Context } from '@neoworks/extension-system';
import { createNode, type Paint, type Stroke } from '../document';
import { keyBetween } from '../document/fractionalIndex';
import {
	composeMatrices,
	identityMatrix,
	invertMatrix,
	transformPoint,
	translationMatrix
} from '../document/matrix';
import type { Matrix2x3, NodeId, VectorNetwork } from '../document/types';
import { applyEdit } from '../editing/contribute';
import { nestingSource } from '../editing/creationTool.svelte';
import { findContainer, nextName } from '../tools/creation';
import type { Point } from '../tools/protocol';
import { normalizeNetwork } from './geometry';

const BLACK: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 0, g: 0, b: 0 }
};

export function vectorStroke(weight = 1): Stroke {
	return {
		paints: [BLACK],
		weight,
		align: 'CENTER',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

/** The space a draft is drawn in and where it will be stored. */
export interface DraftSpace {
	/** Draft coordinates to world. */
	toWorld: Matrix2x3;
	/** The container that receives a new node; for an existing node, its parent. */
	container: NodeId;
	/** Set when the draft edits an existing vector. */
	nodeId?: NodeId;
}

export function absoluteTransformOf(ctx: Context, id: NodeId): Matrix2x3 {
	if (ctx.document.require(id).type === 'PAGE') return identityMatrix();
	return ctx.document.absoluteTransform(id);
}

/** A fresh draft inside the container found under `world` (the first point of the stroke). */
export function newDraftSpace(ctx: Context, world: Point): DraftSpace {
	const container = findContainer(nestingSource(ctx), ctx.document.currentPageId, world);
	return { toWorld: absoluteTransformOf(ctx, container), container };
}

/** A draft that edits the existing vector `nodeId`, in its own local coordinates. */
export function existingDraftSpace(ctx: Context, nodeId: NodeId): DraftSpace {
	const node = ctx.document.require(nodeId);
	const container = node.parentId === null ? ctx.document.currentPageId : node.parentId;
	return { toWorld: ctx.document.absoluteTransform(nodeId), container, nodeId };
}

export function worldToDraft(space: DraftSpace, world: Point): Point {
	const inverse = invertMatrix(space.toWorld);
	if (!inverse) return world;
	return transformPoint(inverse, world.x, world.y);
}

export function draftToWorld(space: DraftSpace, point: Point): Point {
	return transformPoint(space.toWorld, point.x, point.y);
}

function lastIndexIn(ctx: Context, containerId: NodeId): string | null {
	const lastSibling = ctx.document.childNodes(containerId).at(-1);
	if (!lastSibling) return null;
	return lastSibling.index;
}

/** Creates the vector, selects it and returns its id. */
export function createVectorNode(
	ctx: Context,
	network: VectorNetwork,
	container: NodeId,
	options: { label: string; strokeWeight?: number; fills?: Paint[] }
): NodeId {
	const normalized = normalizeNetwork(network);
	const existing = ctx.document.query((node) => node.type === 'VECTOR', ctx.document.currentPageId);
	const node = createNode('VECTOR', {
		name: nextName(
			'Vector',
			existing.map((entry) => entry.name)
		),
		transform: translationMatrix(normalized.origin.x, normalized.origin.y),
		width: normalized.width,
		height: normalized.height,
		network: normalized.network,
		fills: options.fills ?? [],
		strokes: [vectorStroke(options.strokeWeight)],
		parentId: container,
		index: keyBetween(lastIndexIn(ctx, container), null)
	});
	applyEdit(ctx, ctx.document.insertNode(node), options.label);
	ctx.selection.select([node.id]);
	return node.id;
}

/** Stores `network` (draft coordinates of the node itself) on an existing vector node. */
export function updateVectorNode(
	ctx: Context,
	nodeId: NodeId,
	network: VectorNetwork,
	label: string
): void {
	const node = ctx.document.require(nodeId);
	if (node.type !== 'VECTOR') return;
	const normalized = normalizeNetwork(network);
	const transform = composeMatrices(
		node.transform,
		translationMatrix(normalized.origin.x, normalized.origin.y)
	);
	const changes = ctx.document.setProps(nodeId, {
		network: normalized.network,
		transform,
		width: normalized.width,
		height: normalized.height
	});
	applyEdit(ctx, changes, label);
}
