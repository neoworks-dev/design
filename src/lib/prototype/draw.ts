// Canvas2D drawing of connections, handles and flow badges on the overlay (screen space).

import type { Rect } from '../document/types';
import { arrivalAngle, handleCenter, HANDLE_RADIUS, type Curve, type Point } from './connections';

export const CONNECTION_COLOR = '#9747ff';
export const CONNECTION_SELECTED_COLOR = '#0d99ff';
const ARROW_LENGTH = 9;
const ARROW_SPREAD = 0.45;
const START_DOT_RADIUS = 3.5;

export interface ConnectionPaint {
	curve: Curve;
	selected: boolean;
	/** Dashed while a drag has no target yet. */
	pending: boolean;
}

function strokeCurve(ctx: CanvasRenderingContext2D, curve: Curve): void {
	ctx.beginPath();
	ctx.moveTo(curve.start.x, curve.start.y);
	ctx.bezierCurveTo(
		curve.control1.x,
		curve.control1.y,
		curve.control2.x,
		curve.control2.y,
		curve.end.x,
		curve.end.y
	);
	ctx.stroke();
}

function drawArrowhead(ctx: CanvasRenderingContext2D, curve: Curve): void {
	const angle = arrivalAngle(curve);
	const { end } = curve;
	ctx.beginPath();
	ctx.moveTo(end.x, end.y);
	ctx.lineTo(
		end.x - ARROW_LENGTH * Math.cos(angle - ARROW_SPREAD),
		end.y - ARROW_LENGTH * Math.sin(angle - ARROW_SPREAD)
	);
	ctx.lineTo(
		end.x - ARROW_LENGTH * Math.cos(angle + ARROW_SPREAD),
		end.y - ARROW_LENGTH * Math.sin(angle + ARROW_SPREAD)
	);
	ctx.closePath();
	ctx.fill();
}

export function drawConnection(ctx: CanvasRenderingContext2D, paint: ConnectionPaint): void {
	let color = CONNECTION_COLOR;
	if (paint.selected) color = CONNECTION_SELECTED_COLOR;
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = 1.5;
	if (paint.selected) ctx.lineWidth = 2.5;
	if (paint.pending) ctx.setLineDash([5, 4]);
	strokeCurve(ctx, paint.curve);
	ctx.setLineDash([]);
	drawArrowhead(ctx, paint.curve);
	ctx.beginPath();
	ctx.arc(paint.curve.start.x, paint.curve.start.y, START_DOT_RADIUS, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

export function drawHandle(ctx: CanvasRenderingContext2D, nodeRect: Rect, active: boolean): void {
	const center: Point = handleCenter(nodeRect);
	ctx.save();
	ctx.beginPath();
	ctx.arc(center.x, center.y, HANDLE_RADIUS, 0, Math.PI * 2);
	ctx.fillStyle = '#ffffff';
	if (active) ctx.fillStyle = CONNECTION_COLOR;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = CONNECTION_COLOR;
	ctx.stroke();
	ctx.restore();
}

/** A rounded outline around the frame a dragged connection would attach to. */
export function drawTargetOutline(ctx: CanvasRenderingContext2D, frameRect: Rect): void {
	ctx.save();
	ctx.strokeStyle = CONNECTION_COLOR;
	ctx.lineWidth = 2;
	ctx.strokeRect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
	ctx.restore();
}

const BADGE_HEIGHT = 20;
const BADGE_PADDING = 8;
const BADGE_GAP = 26;

/** "Flow 1" badge above a flow's starting frame, clear of the frame's own title. */
export function drawFlowBadge(ctx: CanvasRenderingContext2D, frameRect: Rect, name: string): void {
	ctx.save();
	ctx.font = '600 11px system-ui, sans-serif';
	const width = ctx.measureText(name).width + BADGE_PADDING * 2 + 14;
	const x = frameRect.x;
	const y = frameRect.y - BADGE_GAP - BADGE_HEIGHT;
	ctx.fillStyle = CONNECTION_COLOR;
	ctx.beginPath();
	ctx.roundRect(x, y, width, BADGE_HEIGHT, 4);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.beginPath();
	ctx.moveTo(x + BADGE_PADDING, y + 5);
	ctx.lineTo(x + BADGE_PADDING + 8, y + 8);
	ctx.lineTo(x + BADGE_PADDING, y + 11);
	ctx.closePath();
	ctx.fill();
	ctx.textBaseline = 'middle';
	ctx.fillText(name, x + BADGE_PADDING + 14, y + BADGE_HEIGHT / 2 + 0.5);
	ctx.restore();
}
