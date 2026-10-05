import type { Context } from '@neoworks/extension-system';
import { imageOutline, imageSizeOf } from '../../lib/editing/imageCrop';
import { isPositioned } from '../../lib/editing/selectionOps';
import type { OverlayFrame } from '../../lib/overlay/types';
import type { CropState } from './cropTool.svelte';

const BLUE = '#3b82f6';

export function trackCropOutline(state: CropState): void {
	void state.nodeId;
}

/** The whole image, dashed, as it lies under the cropped node's box. */
export function drawCropOutline(ctx: Context, frame: OverlayFrame, state: CropState): void {
	const id = state.nodeId;
	if (id === null) return;
	const node = ctx.document.get(id);
	if (node === undefined || !isPositioned(node)) return;
	const image = imageSizeOf(ctx.document.reader, node);
	if (image === undefined) return;
	const corners = imageOutline(node, ctx.document.absoluteTransform(id), image);
	if (corners === null) return;
	const canvas = frame.ctx;
	canvas.beginPath();
	corners.forEach((corner, index) => {
		const point = ctx.viewport.worldToScreen(corner);
		if (index === 0) canvas.moveTo(point.x, point.y);
		else canvas.lineTo(point.x, point.y);
	});
	canvas.closePath();
	canvas.setLineDash([4, 3]);
	canvas.lineWidth = 1;
	canvas.strokeStyle = BLUE;
	canvas.stroke();
}
