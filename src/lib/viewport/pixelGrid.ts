// Pixel grid (#46): one-pixel lines on every whole world coordinate, drawn on the overlay layer
// once the zoom reaches 800%. Lines sit on device pixel boundaries (`devicePixelRatio` aware), so
// they stay one device pixel wide and line up with the pixel squares the scene is drawn with.

import type { OverlayFrame } from '../overlay/types';

export const PIXEL_GRID_MIN_SCALE = 8;
export const PIXEL_GRID_COLOR = 'rgba(120, 120, 130, 0.45)';

export function isPixelGridVisible(scale: number): boolean {
	return scale >= PIXEL_GRID_MIN_SCALE;
}

/** Device-pixel aligned position of a line at CSS coordinate `position`. */
function crisp(position: number, devicePixelRatio: number): number {
	return (Math.round(position * devicePixelRatio) + 0.5) / devicePixelRatio;
}

export function drawPixelGrid(frame: OverlayFrame): void {
	const { camera, size, devicePixelRatio, ctx } = frame;
	if (!isPixelGridVisible(camera.scale)) return;
	const firstColumn = Math.ceil(-camera.x / camera.scale);
	const lastColumn = Math.floor((size.width - camera.x) / camera.scale);
	const firstRow = Math.ceil(-camera.y / camera.scale);
	const lastRow = Math.floor((size.height - camera.y) / camera.scale);
	ctx.save();
	ctx.lineWidth = 1 / devicePixelRatio;
	ctx.strokeStyle = PIXEL_GRID_COLOR;
	ctx.beginPath();
	for (let column = firstColumn; column <= lastColumn; column += 1) {
		const x = crisp(column * camera.scale + camera.x, devicePixelRatio);
		ctx.moveTo(x, 0);
		ctx.lineTo(x, size.height);
	}
	for (let row = firstRow; row <= lastRow; row += 1) {
		const y = crisp(row * camera.scale + camera.y, devicePixelRatio);
		ctx.moveTo(0, y);
		ctx.lineTo(size.width, y);
	}
	ctx.stroke();
	ctx.restore();
}
