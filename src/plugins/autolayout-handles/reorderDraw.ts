// The overlay part of a reorder drag: outline of the frame the drop lands in, the blue insertion
// line and outlines of the dragged nodes where the pointer holds them.

import type { Context } from '@neoworks/extension-system';
import type { OverlayFrame } from '../../lib/overlay/types';
import type { HandlesFeedback } from './feedback.svelte';

const BLUE = '#3b82f6';
const GHOST_FILL = 'rgba(59, 130, 246, 0.12)';

export function trackReorder(feedback: HandlesFeedback): void {
	void feedback.reorder;
}

export function drawReorder(ctx: Context, feedback: HandlesFeedback, frame: OverlayFrame): void {
	const reorder = feedback.reorder;
	if (reorder === null) return;
	const context = frame.ctx;
	if (
		ctx.document.has(reorder.targetId) &&
		ctx.document.require(reorder.targetId).type !== 'PAGE'
	) {
		const target = frame.worldRectToScreen(ctx.document.absoluteBounds(reorder.targetId));
		context.lineWidth = 1.5;
		context.strokeStyle = BLUE;
		context.strokeRect(target.x, target.y, target.width, target.height);
	}
	for (const ghost of reorder.ghosts) {
		const rect = frame.worldRectToScreen(ghost);
		context.fillStyle = GHOST_FILL;
		context.fillRect(rect.x, rect.y, rect.width, rect.height);
		context.lineWidth = 1;
		context.strokeStyle = BLUE;
		context.strokeRect(rect.x, rect.y, rect.width, rect.height);
	}
	if (reorder.line === null) return;
	const from = frame.worldToScreen(reorder.line.from);
	const to = frame.worldToScreen(reorder.line.to);
	context.beginPath();
	context.moveTo(from.x, from.y);
	context.lineTo(to.x, to.y);
	context.lineWidth = 3;
	context.lineCap = 'round';
	context.strokeStyle = BLUE;
	context.stroke();
}
