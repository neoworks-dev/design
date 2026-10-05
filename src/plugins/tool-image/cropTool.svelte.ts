// The image crop mode (Alt+double click on an image): the node's box can be dragged smaller with
// the handles (the crop gesture of `transform-handles` maths, `CropSession`), and dragging inside
// the box slides the image under it. The bytes are never touched: the paint becomes
// `scaleMode: 'CROP'` with an `imageTransform`. Enter, Esc or a click outside leave the mode.

import type { Context } from '@neoworks/extension-system';
import {
	invertMatrix,
	planSetProps,
	transformPoint,
	type Matrix2x3,
	type NodeId
} from '../../lib/document';
import { croppableFill, imageSizeOf, moveImage } from '../../lib/editing/imageCrop';
import { isPositioned, type PositionedNode } from '../../lib/editing/selectionOps';
import type { ToolContribution } from '../../lib/registries/tools.svelte';
import type { Point, ToolKeyEvent, ToolPointerEvent } from '../../lib/tools/protocol';

export const CROP_TOOL_ID = 'image-crop';

/** The node being cropped; the overlay reads it. */
export class CropState {
	nodeId = $state<NodeId | null>(null);
}

type CropHandlers = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onCancel' | 'onDeactivate' | 'onKey'
>;

interface ImageDrag {
	snapshot: PositionedNode;
	inverse: Matrix2x3;
	startLocal: Point;
	group: ReturnType<Context['history']['beginGroup']>;
}

/** Start the crop mode on `id` when it has an image whose size the file knows. */
export function enterCropMode(ctx: Context, state: CropState, id: NodeId): boolean {
	const node = ctx.document.get(id);
	if (node === undefined || !isPositioned(node) || node.locked) return false;
	if (croppableFill(node) === undefined) return false;
	if (imageSizeOf(ctx.document.reader, node) === undefined) return false;
	state.nodeId = id;
	ctx.selection.select([id]);
	ctx.tools.activate(CROP_TOOL_ID);
	return true;
}

function localPoint(inverse: Matrix2x3, world: Point): Point {
	return transformPoint(inverse, world.x, world.y);
}

function isInside(node: PositionedNode, local: Point): boolean {
	return local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height;
}

export function createCropTool(ctx: Context, state: CropState): CropHandlers {
	let drag: ImageDrag | undefined;

	const leave = (): void => {
		if (ctx.tools.activeId() === CROP_TOOL_ID) ctx.tools.activate('move');
	};

	const abort = (): void => {
		if (drag === undefined) return;
		ctx.history.cancelGroup(drag.group);
		drag = undefined;
	};

	return {
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== 0) return;
			const id = state.nodeId;
			if (id === null) return leave();
			const node = ctx.document.require(id);
			const inverse = invertMatrix(ctx.document.absoluteTransform(id));
			if (!isPositioned(node) || inverse === null) return leave();
			const startLocal = localPoint(inverse, event.world);
			if (!isInside(node, startLocal)) return leave();
			const group = ctx.history.beginGroup({ label: 'Move image' });
			drag = { snapshot: { ...node }, inverse, startLocal, group };
		},
		onPointerMove(event: ToolPointerEvent): void {
			const active = drag;
			const id = state.nodeId;
			if (active === undefined || id === null) return;
			const image = imageSizeOf(ctx.document.reader, active.snapshot);
			if (image === undefined) return;
			const local = localPoint(active.inverse, event.world);
			const props = moveImage(active.snapshot, image, {
				x: local.x - active.startLocal.x,
				y: local.y - active.startLocal.y
			});
			if (props === null) return;
			const changes = planSetProps(ctx.document.reader, id, { ...props });
			if (changes.length === 0) return;
			ctx.document.apply(changes, { origin: 'user', label: 'Move image' });
		},
		onPointerUp(): void {
			const active = drag;
			drag = undefined;
			if (active !== undefined) ctx.history.endGroup(active.group);
		},
		onKey(event: ToolKeyEvent): boolean {
			if (event.key !== 'Enter') return false;
			leave();
			return true;
		},
		onCancel(): boolean {
			if (drag !== undefined) {
				abort();
				return true;
			}
			if (state.nodeId === null) return false;
			leave();
			return true;
		},
		onDeactivate(): void {
			abort();
			state.nodeId = null;
		}
	};
}
