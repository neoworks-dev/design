// The outline drawn around what the last AI run changed (screen space, Canvas2D).

import type { Rect } from '../document';
import type { OverlayFrame } from '../overlay/types';

export const HIGHLIGHT_COLOR = '#9747ff';

/** Dashed outlines around `bounds` (world rectangles), a soft fill inside. */
export function drawAiHighlight(frame: OverlayFrame, bounds: readonly Rect[]): void {
	const { ctx } = frame;
	ctx.save();
	ctx.setLineDash([4, 3]);
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = HIGHLIGHT_COLOR;
	ctx.fillStyle = 'rgba(151, 71, 255, 0.08)';
	for (const rect of bounds) {
		const screen = frame.worldRectToScreen(rect);
		ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
		ctx.strokeRect(screen.x, screen.y, screen.width, screen.height);
	}
	ctx.restore();
}
