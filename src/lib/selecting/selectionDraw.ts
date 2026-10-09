// Draws the Move tool's feedback on the overlay canvas: selection, hover and drop-target outlines,
// the marquee and the snap guides. Screen space, CSS pixels (see src/lib/overlay/types.ts).

import type { Context } from '@neoworks/extension-system';
import type { DocumentReader } from '../document';
import type { OverlayFrame } from '../overlay/types';
import type { Point } from '../tools/protocol';
import { worldToScreen } from '../viewport/camera';
import type { MoveToolState } from './moveTool.svelte';
import { isComponentLike, screenCorners, screenRect, type OutlineSource } from './outline';

const BLUE = '#3b82f6';
const VIOLET = '#8b5cf6';
const RED = '#ef4444';
const MARQUEE_FILL = 'rgba(59, 130, 246, 0.1)';

// One per frame: the plain reader and the camera, so outlining thousands of selected nodes does
// not go through the kernel's service proxies for every corner.
function outlineSource(ctx: Context): OutlineSource {
	const reader = ctx.document.reader;
	const camera = ctx.viewport.camera;
	return {
		size: (id) => {
			const node = reader.requireNode(id);
			if (node.type === 'PAGE') return { width: 0, height: 0 };
			return { width: node.width, height: node.height };
		},
		absoluteTransform: (id) => reader.cache.absoluteTransform(id),
		worldToScreen: (point) => worldToScreen(camera, point)
	};
}

function tracePolygon(canvas: CanvasRenderingContext2D, corners: readonly Point[]): void {
	corners.forEach((corner, index) => {
		if (index === 0) canvas.moveTo(corner.x, corner.y);
		else canvas.lineTo(corner.x, corner.y);
	});
	canvas.closePath();
}

function strokePath(canvas: CanvasRenderingContext2D, color: string, width: number): void {
	canvas.lineWidth = width;
	canvas.strokeStyle = color;
	canvas.stroke();
}

function strokeNode(
	frame: OverlayFrame,
	source: OutlineSource,
	id: string,
	color: string,
	width: number
): void {
	frame.ctx.beginPath();
	tracePolygon(frame.ctx, screenCorners(source, id));
	strokePath(frame.ctx, color, width);
}

function nodeColor(reader: DocumentReader, id: string): string {
	if (isComponentLike(reader.requireNode(id).type)) return VIOLET;
	return BLUE;
}

/** Every selected node's outline, one path (and one stroke) per colour. */
function strokeSelection(ctx: Context, frame: OverlayFrame, source: OutlineSource): void {
	const reader = ctx.document.reader;
	const byColor = new Map<string, string[]>();
	for (const id of ctx.selection.ids) {
		if (!reader.hasNode(id)) continue;
		const color = nodeColor(reader, id);
		const ids = byColor.get(color);
		if (ids === undefined) byColor.set(color, [id]);
		else ids.push(id);
	}
	for (const [color, ids] of byColor) {
		frame.ctx.beginPath();
		for (const id of ids) tracePolygon(frame.ctx, screenCorners(source, id));
		strokePath(frame.ctx, color, 1);
	}
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
	const reader = ctx.document.reader;
	const source = outlineSource(ctx);
	const hoverId = ctx.selection.hoverId;
	if (hoverId !== null && !ctx.selection.has(hoverId) && reader.hasNode(hoverId)) {
		strokeNode(frame, source, hoverId, nodeColor(reader, hoverId), 1);
	}
	strokeSelection(ctx, frame, source);
	const dropId = state.dropTargetId;
	if (dropId !== null && reader.hasNode(dropId)) strokeNode(frame, source, dropId, BLUE, 2);
	drawMarquee(ctx, frame, state);
	drawSnapGuides(ctx, frame);
}
