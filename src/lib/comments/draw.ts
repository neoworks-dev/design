// Drawing comment pins on the overlay (screen space, Canvas2D). A pin is a round bubble with a
// small tail whose tip is the commented point; open comments are filled with the action colour and
// numbered, resolved ones are grey, the one being edited gets a ring, a draft is dashed.

import type { OverlayFrame } from '../overlay/types';
import type { Point } from './model';

export interface PinPaint {
	/** The tail tip, in canvas pixels. */
	tip: Point;
	number: number | null;
	resolved: boolean;
	selected: boolean;
	draft: boolean;
}

export const OPEN_FILL = '#0d99ff';
export const RESOLVED_FILL = '#8a8a90';
const RING = '#ffffff';
const LABEL = '#ffffff';

function bubblePath(ctx: CanvasRenderingContext2D, tip: Point, radius: number): void {
	const centre = { x: tip.x, y: tip.y - radius };
	ctx.beginPath();
	// A circle whose lower left quarter is replaced by the tail, like a speech bubble.
	ctx.arc(centre.x, centre.y, radius, -Math.PI / 2, Math.PI / 2 - 0.1, false);
	ctx.lineTo(tip.x, tip.y);
	ctx.lineTo(centre.x - radius, centre.y);
	ctx.arc(centre.x, centre.y, radius, Math.PI, 1.5 * Math.PI, false);
	ctx.closePath();
}

function drawPin(frame: OverlayFrame, pin: PinPaint, radius: number): void {
	const { ctx } = frame;
	ctx.save();
	bubblePath(ctx, pin.tip, radius);
	if (pin.draft) {
		ctx.setLineDash([3, 3]);
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = OPEN_FILL;
		ctx.fillStyle = 'rgba(13, 153, 255, 0.15)';
		ctx.fill();
		ctx.stroke();
		ctx.restore();
		return;
	}
	if (pin.resolved) ctx.fillStyle = RESOLVED_FILL;
	else ctx.fillStyle = OPEN_FILL;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = RING;
	ctx.stroke();
	if (pin.selected) {
		ctx.setLineDash([]);
		ctx.lineWidth = 2;
		ctx.strokeStyle = OPEN_FILL;
		ctx.beginPath();
		ctx.arc(pin.tip.x, pin.tip.y - radius, radius + 4, 0, Math.PI * 2);
		ctx.stroke();
	}
	if (pin.number !== null) {
		ctx.fillStyle = LABEL;
		ctx.font = '600 11px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(pin.number), pin.tip.x, pin.tip.y - radius);
	}
	ctx.restore();
}

/** Draw every pin; the selected one last so its ring is on top. */
export function drawPins(frame: OverlayFrame, pins: readonly PinPaint[], radius: number): void {
	const ordered = [...pins].sort((left, right) => Number(left.selected) - Number(right.selected));
	for (const pin of ordered) drawPin(frame, pin, radius);
}
