// Camera math, pure and in float64. A camera maps world coordinates (document units) to screen
// coordinates (CSS pixels of the canvas element):
//
//   screen = world * scale + offset
//
// Pointer-anchored zoom keeps the world point under the cursor fixed:
//
//   newOffset = cursor - (cursor - offset) * (newScale / oldScale)

import type { Rect } from '../document/types';
import type { Size } from '../kernel/types';
import type { ViewTransform } from '../renderer/types';

export type Camera = ViewTransform;

export interface ScreenPoint {
	x: number;
	y: number;
}

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 256;

/** Zoom presets in percent, the ladder Ctrl + / Ctrl - steps through (docs: interactions 6). */
export const ZOOM_LADDER_PERCENT = [
	1, 2, 3, 4, 5, 6.25, 8, 12.5, 16.67, 25, 33, 50, 66, 100, 150, 200, 300, 400, 800, 1600, 3200,
	6400, 12800, 25600
];

export function defaultCamera(): Camera {
	return { x: 0, y: 0, scale: 1 };
}

export function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(camera: Camera, point: ScreenPoint): ScreenPoint {
	return { x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y };
}

export function screenToWorld(camera: Camera, point: ScreenPoint): ScreenPoint {
	return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function panCamera(camera: Camera, deltaX: number, deltaY: number): Camera {
	return { x: camera.x + deltaX, y: camera.y + deltaY, scale: camera.scale };
}

/** Zoom to `scale` (clamped) keeping the world point under `anchor` (a screen point) fixed. */
export function zoomCameraAt(camera: Camera, anchor: ScreenPoint, scale: number): Camera {
	const newScale = clampScale(scale);
	const ratio = newScale / camera.scale;
	return {
		x: anchor.x - (anchor.x - camera.x) * ratio,
		y: anchor.y - (anchor.y - camera.y) * ratio,
		scale: newScale
	};
}

/** The world rectangle that is visible in a canvas of `size` CSS pixels. */
export function visibleWorldRect(camera: Camera, size: Size): Rect {
	return {
		x: -camera.x / camera.scale,
		y: -camera.y / camera.scale,
		width: size.width / camera.scale,
		height: size.height / camera.scale
	};
}

export interface FitOptions {
	/** Free space around the content, in CSS pixels, on every side. */
	padding: number;
	/** Upper bound for the resulting scale. */
	maxScale: number;
}

export const DEFAULT_FIT: FitOptions = { padding: 64, maxScale: MAX_SCALE };

/** Camera that centres `rect` in a canvas of `size` with `padding` around it. */
export function fitCamera(rect: Rect, size: Size, options: FitOptions = DEFAULT_FIT): Camera {
	const availableWidth = Math.max(1, size.width - options.padding * 2);
	const availableHeight = Math.max(1, size.height - options.padding * 2);
	const fitScale = Math.min(availableWidth / rect.width, availableHeight / rect.height);
	const scale = clampScale(Math.min(fitScale, options.maxScale));
	const centreX = rect.x + rect.width / 2;
	const centreY = rect.y + rect.height / 2;
	return { x: size.width / 2 - centreX * scale, y: size.height / 2 - centreY * scale, scale };
}

/** Relative tolerance so a scale that is "on" a stop does not step to the same stop. */
const STOP_TOLERANCE = 1e-3;

/** The next ladder stop above (`in`) or below (`out`) `scale`, or `scale` at either end. */
export function nextZoomStop(scale: number, direction: 'in' | 'out'): number {
	const stops = ZOOM_LADDER_PERCENT.map((percent) => percent / 100);
	if (direction === 'in') {
		const above = stops.find((stop) => stop > scale * (1 + STOP_TOLERANCE));
		if (above === undefined) return clampScale(scale);
		return above;
	}
	const below = [...stops].reverse().find((stop) => stop < scale * (1 - STOP_TOLERANCE));
	if (below === undefined) return clampScale(scale);
	return below;
}

/** Smallest rectangle containing all of `rects`; null when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
	if (rects.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const rect of rects) {
		minX = Math.min(minX, rect.x);
		minY = Math.min(minY, rect.y);
		maxX = Math.max(maxX, rect.x + rect.width);
		maxY = Math.max(maxY, rect.y + rect.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
