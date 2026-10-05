// Draws the Move tool's feedback on the overlay canvas: selection, hover and drop-target outlines,
// the marquee and the snap guides. Screen space, CSS pixels (see src/lib/overlay/types.ts).

import type { Context } from '@neoworks/extension-system';
import type { OverlayFrame } from '../overlay/types';
import type { Point } from '../tools/protocol';
import type { MoveToolState } from './moveTool.svelte';
import { isComponentLike, screenCorners, screenRect, type OutlineSource } from './outline';

const BLUE = '#3b82f6';
const VIOLET = '#8b5cf6';
const RED = '#ef4444';
const MARQUEE_FILL = 'rgba(59, 130, 246, 0.1)';

function outlineSource(ctx: Context): OutlineSource {
	return {
		size: (id) => {
			const node = ctx.document.require(id);
			if (node.type === 'PAGE') return { width: 0, height: 0 };
			return { width: node.width, height: node.height };
		},
		absoluteTransform: (id) => ctx.document.absoluteTransform(id),
		worldToScreen: (point) => ctx.viewport.worldToScreen(point)
	};
}

function strokePolygon(
	canvas: CanvasRenderingContext2D,
	corners: readonly Point[],
	color: string,
	width: number
): void {
	canvas.beginPath();
	corners.forEach((corner, index) => {
		if (index === 0) canvas.moveTo(corner.x, corner.y);
		else canvas.lineTo(corner.x, corner.y);
	});
	canvas.closePath();
	canvas.lineWidth = width;
	canvas.strokeStyle = color;
	canvas.stroke();
}

function strokeNode(
	ctx: Context,
	frame: OverlayFrame,
	id: string,
	color: string,
	width: number
): void {
	strokePolygon(frame.ctx, screenCorners(outlineSource(ctx), id), color, width);
}

function nodeColor(ctx: Context, id: string): string {
	if (isComponentLike(ctx.document.require(id).type)) return VIOLET;
	return BLUE;
}

function drawMarquee(ctx: Context, frame: OverlayFrame, state: MoveToolState): void {
	if (state.marquee === null) return;
	const rect = screenRect(state.marquee, (point) => ctx.viewport.worldToScreen(point));
	frame.ctx.fillStyle = MARQUEE_FILL;
	frame.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
	frame.ctx.lineWidth = 1;
	frame.ctx.strokeStyle = BLUE;
	frame.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function drawSnapGuides(ctx: Context, frame: OverlayFrame): void {
	const canvas = frame.ctx;
	canvas.lineWidth = 1;
	canvas.strokeStyle = RED;
	for (const guide of ctx.snapping.guides) {
		const vertical = guide.axis === 'x';
		const from = vertical
			? { x: guide.position, y: guide.start }
			: { x: guide.start, y: guide.position };
		const to = vertical ? { x: guide.position, y: guide.end } : { x: guide.end, y: guide.position };
		const start = ctx.viewport.worldToScreen(from);
		const end = ctx.viewport.worldToScreen(to);
		canvas.beginPath();
		canvas.moveTo(start.x, start.y);
		canvas.lineTo(end.x, end.y);
		canvas.stroke();
	}
}

/** Reads every reactive input of `drawSelectionFeedback`, so a change redraws the overlay. */
export function trackSelectionFeedback(ctx: Context, state: MoveToolState): void {
	void ctx.selection.ids;
	void ctx.selection.hoverId;
	void state.marquee;
	void state.dropTargetId;
	void ctx.snapping.guides;
}

export function drawSelectionFeedback(
	ctx: Context,
	frame: OverlayFrame,
	state: MoveToolState
): void {
	const hoverId = ctx.selection.hoverId;
	if (hoverId !== null && !ctx.selection.has(hoverId) && ctx.document.has(hoverId)) {
		strokeNode(ctx, frame, hoverId, nodeColor(ctx, hoverId), 1);
	}
	for (const id of ctx.selection.ids) {
		if (ctx.document.has(id)) strokeNode(ctx, frame, id, nodeColor(ctx, id), 1);
	}
	const dropId = state.dropTargetId;
	if (dropId !== null && ctx.document.has(dropId)) strokeNode(ctx, frame, dropId, BLUE, 2);
	drawMarquee(ctx, frame, state);
	drawSnapGuides(ctx, frame);
}
