// What every draw function receives: the Skia canvas already set to world space, a scope that
// deletes temporaries when the frame ends, and the counters reported in FrameResult.

import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import type { SkiaScope } from '../ownership';
import type { NodeId } from '../../document/types';
import type { PictureCache } from '../pictureCache';
import type { SceneSource } from '../sceneSource';
import type { FrameRequest, ViewTransform } from '../types';
import { DEFAULT_DRAW_HOOKS, type DrawHooks } from './hooks';

export interface DrawCounters {
	drawnNodes: number;
	layers: number;
	picturesReplayed: number;
	picturesRecorded: number;
}

export interface DrawContext {
	canvasKit: CanvasKit;
	canvas: Canvas;
	scope: SkiaScope;
	source: SceneSource;
	view: ViewTransform;
	counters: DrawCounters;
	hooks: DrawHooks;
	/** Nodes worth drawing (visible ones and their ancestors); null draws everything. */
	needed: ReadonlySet<NodeId> | null;
	/** Container recordings; null draws every container directly. */
	pictures: PictureCache | null;
}

export interface DrawExtras {
	needed?: ReadonlySet<NodeId> | null;
	pictures?: PictureCache | null;
}

export function createDrawContext(
	canvasKit: CanvasKit,
	canvas: Canvas,
	scope: SkiaScope,
	request: FrameRequest,
	hooks: DrawHooks = DEFAULT_DRAW_HOOKS,
	extras: DrawExtras = {}
): DrawContext {
	return {
		canvasKit,
		canvas,
		scope,
		source: request.source,
		view: request.view,
		counters: { drawnNodes: 0, layers: 0, picturesReplayed: 0, picturesRecorded: 0 },
		hooks,
		needed: extras.needed === undefined ? null : extras.needed,
		pictures: extras.pictures === undefined ? null : extras.pictures
	};
}
