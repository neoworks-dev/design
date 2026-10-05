// While the camera only pans, the scene does not change: a frame can be the previous rendering
// shifted. Replaying every node instead (blurs, shadows, masks at full resolution) is what made
// panning slow where WebGL is expensive (Firefox's remoted WebGL on Linux). The snapshot covers the
// viewport plus a margin on every side, is rendered at the current zoom and device pixel ratio,
// and is dropped by anything that is not a pure pan: edits, zoom, resize, hooks, surface resets.

import type { Canvas, CanvasKit, Image } from 'canvaskit-wasm';
import type { Size } from '../kernel/types';
import type { FrameResult, ViewTransform } from './types';

/** Fraction of the viewport added on each side, so short pans stay inside the snapshot. */
const MARGIN_FRACTION = 0.25;
/** Larger snapshots cost more to build than they save; fall back to drawing directly. */
const MAX_SNAPSHOT_PIXELS = 4096;

export interface SnapshotArea {
	/** View of the snapshot: the camera moved so the snapshot's top left is the canvas origin. */
	view: ViewTransform;
	/** Snapshot size in CSS pixels. */
	size: Size;
}

interface Snapshot {
	image: Image;
	area: SnapshotArea;
	scale: number;
	devicePixelRatio: number;
	result: FrameResult;
}

export class PanSnapshot {
	private current: Snapshot | null = null;

	constructor(private readonly canvasKit: CanvasKit) {}

	/** The area a new snapshot for this camera should cover, or null when it would be too large. */
	areaFor(view: ViewTransform, size: Size, devicePixelRatio: number): SnapshotArea | null {
		const marginX = Math.ceil(size.width * MARGIN_FRACTION);
		const marginY = Math.ceil(size.height * MARGIN_FRACTION);
		const width = size.width + marginX * 2;
		const height = size.height + marginY * 2;
		const tooLarge = Math.max(width, height) * devicePixelRatio > MAX_SNAPSHOT_PIXELS;
		if (tooLarge) return null;
		return {
			view: { x: view.x + marginX, y: view.y + marginY, scale: view.scale },
			size: { width, height }
		};
	}

	/** Keep `image` (ownership moves here) as the rendering of `area`. */
	store(image: Image, area: SnapshotArea, devicePixelRatio: number, result: FrameResult): void {
		this.drop();
		this.current = { image, area, scale: area.view.scale, devicePixelRatio, result };
	}

	/**
	 * Draw the snapshot for this camera onto `canvas` (in CSS pixels, already scaled by the device
	 * pixel ratio). Returns the result the snapshot was rendered with, or null when it cannot serve
	 * this camera and the frame must be drawn for real.
	 */
	draw(
		canvas: Canvas,
		view: ViewTransform,
		size: Size,
		devicePixelRatio: number
	): FrameResult | null {
		const snapshot = this.current;
		if (snapshot === null) return null;
		if (snapshot.scale !== view.scale || snapshot.devicePixelRatio !== devicePixelRatio) {
			return null;
		}
		const offsetX = view.x - snapshot.area.view.x;
		const offsetY = view.y - snapshot.area.view.y;
		const covers =
			offsetX <= 0 &&
			offsetY <= 0 &&
			offsetX + snapshot.area.size.width >= size.width &&
			offsetY + snapshot.area.size.height >= size.height;
		if (!covers) return null;
		// Whole device pixels: a fractional shift would resample (blur) the snapshot. The
		// renderer draws the scene for real once the pan settles.
		const pixelX = Math.round(offsetX * devicePixelRatio) / devicePixelRatio;
		const pixelY = Math.round(offsetY * devicePixelRatio) / devicePixelRatio;
		const { width, height } = snapshot.area.size;
		canvas.drawImageRectOptions(
			snapshot.image,
			Float32Array.of(0, 0, width * devicePixelRatio, height * devicePixelRatio),
			Float32Array.of(pixelX, pixelY, pixelX + width, pixelY + height),
			this.canvasKit.FilterMode.Nearest,
			this.canvasKit.MipmapMode.None,
			null
		);
		const approximate = pixelX !== offsetX || pixelY !== offsetY;
		return { ...snapshot.result, fromSnapshot: true, approximate };
	}

	get isEmpty(): boolean {
		return this.current === null;
	}

	drop(): void {
		this.current?.image.delete();
		this.current = null;
	}
}
