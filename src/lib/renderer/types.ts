// The backend-agnostic renderer contract (docs/research/rendering.md, recommendation 2). The
// CanvasKit backend implements it; a Canvas2D fallback or a headless export backend could too.
// Pure types: no Svelte, no kernel, no DOM.

import type { Size } from '../kernel/types';
import type { NodeId, Rect } from '../document/types';
import type { SceneChange, SceneSource } from './sceneSource';

/**
 * Camera: a world point `(wx, wy)` appears at the screen (canvas element, CSS pixel) position
 * `(wx * scale + x, wy * scale + y)`. World coordinates are float64, the matrix handed to Skia is
 * float32, which is why very large coordinates need a camera-relative origin (see viewport).
 */
export interface ViewTransform {
	x: number;
	y: number;
	scale: number;
}

export const IDENTITY_VIEW: ViewTransform = { x: 0, y: 0, scale: 1 };

/** Which nodes can show in a rectangle of the page: the spatial index, as the renderer sees it. */
export interface SceneCulling {
	visibleNodes(pageId: NodeId, rect: Rect): readonly NodeId[];
}

export interface FrameRequest {
	source: SceneSource;
	/** Without it every node is drawn. */
	culling?: SceneCulling;
	view: ViewTransform;
	/** Canvas size in CSS pixels. */
	size: Size;
	devicePixelRatio: number;
}

export interface FrameResult {
	/** False when the surface could not be drawn on (lost context, nothing attached). */
	drawn: boolean;
	/** Nodes whose own content was drawn (culled and hidden nodes are not counted). */
	drawnNodes: number;
	/** `saveLayer` calls issued for this frame (compositing cost). */
	layers: number;
	/** Picture caches: containers replayed from a recording and containers recorded this frame. */
	picturesReplayed?: number;
	picturesRecorded?: number;
}

export interface RenderBackend {
	/** Pixel size of the target; called when the canvas or the device pixel ratio changed. */
	resize(pixelWidth: number, pixelHeight: number): void;
	render(request: FrameRequest): FrameResult;
	/** Something drawn earlier may have changed: drop cached pictures it affects. */
	invalidate?(change: SceneChange | 'everything'): void;
	dispose(): void;
}

export interface RendererStats {
	/** Frames drawn since the renderer started. */
	frames: number;
	lastFrameMilliseconds: number;
	averageFrameMilliseconds: number;
	/** Why the last frame was requested (`scene`, `viewport`, `surface-reset`, ...). */
	lastReasons: string[];
	lastResult: FrameResult;
	surfaceResets: number;
}

export interface Renderer {
	readonly stats: RendererStats;
	/** Shows `source`; the returned disposer removes it only if it is still the current one. */
	setSceneSource(source: SceneSource): () => void;
	/** Draws a frame on the next animation frame; calls in the same tick share that frame. */
	requestFrame(reason: string): void;
}
