// The CanvasKit implementation of RenderBackend: clear with the page background, apply the camera,
// draw the page's nodes. A full-viewport redraw per frame, as recommended in
// docs/research/rendering.md; picture caching comes only when profiling asks for it.

import type { CanvasKit } from 'canvaskit-wasm';
import type { NodeId } from '../document/types';
import { createDrawContext } from './draw/context';
import { PictureCache } from './pictureCache';
import type { SceneChange } from './sceneSource';
import { DEFAULT_DRAW_HOOKS, type DrawHooks } from './draw/hooks';
import { drawScene } from './draw/scene';
import { pageBackground } from './draw/background';
import type { SkiaTracker } from './ownership';
import type { RenderSurface } from './surface';
import type { FrameRequest, FrameResult, RenderBackend } from './types';
import type { SceneSource } from './sceneSource';

const NOT_DRAWN: FrameResult = { drawn: false, drawnNodes: 0, layers: 0 };

export class CanvasKitBackend implements RenderBackend {
	private readonly pictures: PictureCache;
	private lastSource: SceneSource | undefined;

	constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker,
		private readonly surface: RenderSurface,
		private readonly hooks: DrawHooks = DEFAULT_DRAW_HOOKS
	) {
		this.pictures = new PictureCache(canvasKit, tracker);
	}

	/** Recordings of page-level containers; exposed for tests and the debug surface. */
	get pictureCache(): PictureCache {
		return this.pictures;
	}

	invalidate(change: SceneChange | 'everything'): void {
		if (change === 'everything' || !this.lastSource) {
			this.pictures.clear();
			return;
		}
		this.pictures.invalidate(this.lastSource, change);
	}

	resize(pixelWidth: number, pixelHeight: number): void {
		this.surface.resize(pixelWidth, pixelHeight);
	}

	render(request: FrameRequest): FrameResult {
		const scope = this.tracker.scope();
		let result = NOT_DRAWN;
		try {
			const drawn = this.surface.frame((canvas) => {
				const { source, view, devicePixelRatio } = request;
				canvas.clear(pageBackground(this.canvasKit, source));
				canvas.save();
				canvas.scale(devicePixelRatio, devicePixelRatio);
				canvas.translate(view.x, view.y);
				canvas.scale(view.scale, view.scale);
				this.lastSource = request.source;
				const context = createDrawContext(this.canvasKit, canvas, scope, request, this.hooks, {
					needed: neededNodes(request),
					pictures: this.pictures
				});
				result = drawScene(context);
				canvas.restore();
			});
			if (!drawn) return NOT_DRAWN;
			return result;
		} finally {
			scope.dispose();
		}
	}

	dispose(): void {
		this.pictures.dispose();
		this.surface.dispose();
	}
}

/** The nodes the camera can see plus their ancestors; null when the request has no culling. */
function neededNodes(request: FrameRequest): ReadonlySet<NodeId> | null {
	const { culling, source, view, size } = request;
	if (!culling) return null;
	const pageId = source.currentPageId();
	if (pageId === null) return null;
	const rect = {
		x: -view.x / view.scale,
		y: -view.y / view.scale,
		width: size.width / view.scale,
		height: size.height / view.scale
	};
	const needed = new Set<NodeId>();
	for (const id of culling.visibleNodes(pageId, rect)) addWithAncestors(source, needed, id);
	return needed;
}

function addWithAncestors(source: SceneSource, needed: Set<NodeId>, id: NodeId): void {
	let current: NodeId | null = id;
	while (current !== null && !needed.has(current)) {
		needed.add(current);
		const node = source.getNode(current);
		if (!node) return;
		current = node.parentId;
	}
}
