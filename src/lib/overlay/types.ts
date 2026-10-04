// What an overlay contribution receives. Overlays draw in screen space: a Canvas2D context whose
// units are CSS pixels, so a 1px line is one device-independent pixel at any zoom and stays crisp
// (the camera is applied to points, never to the context). Choice for #38: one 2D canvas for
// everything non-interactive (outlines, guides, grid, measurements); interactive handles remain
// DOM components in the `canvas-overlay` region, which accept pointer events by opting in.

import type { Rect } from '../document/types';
import type { Size } from '../kernel/types';
import type { Camera, ScreenPoint } from '../viewport/camera';

export interface OverlayFrame {
	ctx: CanvasRenderingContext2D;
	camera: Camera;
	/** Overlay size in CSS pixels. */
	size: Size;
	devicePixelRatio: number;
	worldToScreen: (point: ScreenPoint) => ScreenPoint;
	/** The screen rectangle covering `rect` (world units). */
	worldRectToScreen: (rect: Rect) => Rect;
}

export interface OverlayContribution {
	id: string;
	/** Ascending: higher orders draw on top. Defaults to 0. */
	order?: number;
	draw(frame: OverlayFrame): void;
	/**
	 * Reads the reactive state `draw` depends on (for example `void snapping.guides`). The host
	 * re-runs it in an effect, so a change to that state redraws the overlay. Camera changes,
	 * selection, tool, page and document changes redraw on their own.
	 */
	track?(): void;
}
