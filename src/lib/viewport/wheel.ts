// What a wheel / trackpad event means for the camera. Pure.
//
// - plain wheel: pans (two-finger scroll on a trackpad pans in both axes),
// - Shift + wheel: pans horizontally (the vertical delta moves the camera sideways),
// - Ctrl + wheel and pinch (browsers report a pinch as a wheel event with ctrlKey): zoom to cursor.

import type { Size } from '../kernel/types';
import type { ScreenPoint } from './camera';

/** The wheel event as the canvas hands it to the viewport (see the `canvas/wheel` kernel event). */
export interface CanvasWheelEvent {
	deltaX: number;
	deltaY: number;
	/** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
	deltaMode: number;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	/** Cursor position in canvas CSS pixels. */
	screen: ScreenPoint;
	preventDefault(): void;
}

export type WheelAction =
	| { kind: 'pan'; deltaX: number; deltaY: number }
	| { kind: 'zoom'; anchor: ScreenPoint; factor: number };

const PIXELS_PER_LINE = 16;
/** Ctrl + wheel tick (a delta of 100) zooms by about 22 percent; a pinch delta of 10 by 2.5. */
const ZOOM_SENSITIVITY = 0.0025;
const MAX_ZOOM_DELTA = 100;

function pixelDelta(delta: number, deltaMode: number, pageSize: number): number {
	if (deltaMode === 1) return delta * PIXELS_PER_LINE;
	if (deltaMode === 2) return delta * pageSize;
	return delta;
}

export function wheelAction(event: CanvasWheelEvent, canvasSize: Size): WheelAction {
	const deltaX = pixelDelta(event.deltaX, event.deltaMode, canvasSize.width);
	const deltaY = pixelDelta(event.deltaY, event.deltaMode, canvasSize.height);
	if (event.ctrlKey || event.metaKey) {
		const clamped = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, deltaY));
		return { kind: 'zoom', anchor: event.screen, factor: Math.exp(-clamped * ZOOM_SENSITIVITY) };
	}
	if (event.shiftKey && deltaX === 0) return { kind: 'pan', deltaX: -deltaY, deltaY: 0 };
	return { kind: 'pan', deltaX: -deltaX, deltaY: -deltaY };
}
