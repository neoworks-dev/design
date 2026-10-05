// The CanvasKit implementation of RenderBackend: clear with the page background, apply the camera,
// draw the page's nodes. A full-viewport redraw per frame, as recommended in
// docs/research/rendering.md; picture caching comes only when profiling asks for it.

import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import type { NodeId } from '../document/types';
import { createDrawContext } from './draw/context';
import { PanSnapshot, type SnapshotArea } from './panSnapshot';
import { PictureCache } from './pictureCache';
import type { SceneChange } from './sceneSource';
import { DEFAULT_DRAW_HOOKS, type DrawHooks } from './draw/hooks';
import { drawScene } from './draw/scene';
import { pageBackground } from './draw/background';
import type { SkiaScope, SkiaTracker } from './ownership';
import type { RenderSurface } from './surface';
import type { FrameRequest, FrameResult, RenderBackend } from './types';
import type { SceneSource } from './sceneSource';

const NOT_DRAWN: FrameResult = { drawn: false, drawnNodes: 0, layers: 0 };

export class CanvasKitBackend implements RenderBackend {
	private readonly pictures: PictureCache;
	private readonly snapshot: PanSnapshot;
	/** Zoom and pixel ratio of the previous frame: a snapshot only pays off within one zoom level. */
	private readonly previous = { scale: Number.NaN, devicePixelRatio: Number.NaN };
	private lastSource: SceneSource | undefined;

	constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker,
		private readonly surface: RenderSurface,
		private readonly hooks: DrawHooks = DEFAULT_DRAW_HOOKS
	) {
		this.pictures = new PictureCache(canvasKit, tracker);
		this.snapshot = new PanSnapshot(canvasKit);
	}

	/** Recordings of page-level containers; exposed for tests and the debug surface. */
	get pictureCache(): PictureCache {
		return this.pictures;
	}

	invalidate(change: SceneChange | 'everything'): void {
		this.snapshot.drop();
		if (change === 'everything' || !this.lastSource) {
			this.pictures.clear();
			return;
		}
		this.pictures.invalidate(this.lastSource, change);
	}

	resize(pixelWidth: number, pixelHeight: number): void {
		this.snapshot.drop();
		this.surface.resize(pixelWidth, pixelHeight);
	}

	render(request: FrameRequest): FrameResult {
		const sameZoom =
			request.view.scale === this.previous.scale &&
			request.devicePixelRatio === this.previous.devicePixelRatio;
		this.previous.scale = request.view.scale;
		this.previous.devicePixelRatio = request.devicePixelRatio;
		const usesSnapshot = request.panOnly === true && request.pixelPreview !== true && sameZoom;
		if (!usesSnapshot) {
			this.snapshot.drop();
			return this.renderDirect(request);
		}
		const shifted = this.renderFromSnapshot(request);
		if (shifted !== null) return shifted;
		this.captureSnapshot(request);
		return this.renderFromSnapshot(request) ?? this.renderDirect(request);
	}

	/** Shift the pan snapshot into place; null when there is none that covers this camera. */
	private renderFromSnapshot(request: FrameRequest): FrameResult | null {
		if (this.snapshot.isEmpty) return null;
		let result: FrameResult | null = null;
		const drawn = this.surface.frame((canvas) => {
			const { source, view, size, devicePixelRatio } = request;
			canvas.clear(pageBackground(this.canvasKit, source));
			canvas.save();
			canvas.scale(devicePixelRatio, devicePixelRatio);
			result = this.snapshot.draw(canvas, view, size, devicePixelRatio);
			canvas.restore();
		});
		if (!drawn) return null;
		return result;
	}

	/** Render the viewport plus a margin into an offscreen surface and keep it as the snapshot. */
	private captureSnapshot(request: FrameRequest): void {
		this.snapshot.drop();
		const { view, size, devicePixelRatio } = request;
		const area = this.snapshot.areaFor(view, size, devicePixelRatio);
		if (area === null) return;
		const scratch = this.surface.makeScratchSurface(
			Math.ceil(area.size.width * devicePixelRatio),
			Math.ceil(area.size.height * devicePixelRatio)
		);
		if (scratch === null) return;
		const scope = this.tracker.scope();
		try {
			const result = this.drawSnapshot(scratch.getCanvas(), scope, request, area);
			scratch.flush();
			const image = this.tracker.track(scratch.makeImageSnapshot());
			this.snapshot.store(image, area, devicePixelRatio, result);
		} finally {
			scope.dispose();
			scratch.delete();
		}
	}

	private drawSnapshot(
		canvas: Canvas,
		scope: SkiaScope,
		request: FrameRequest,
		area: SnapshotArea
	): FrameResult {
		const areaRequest: FrameRequest = { ...request, view: area.view, size: area.size };
		canvas.clear(pageBackground(this.canvasKit, request.source));
		canvas.save();
		canvas.scale(request.devicePixelRatio, request.devicePixelRatio);
		this.lastSource = request.source;
		const result = this.drawScene(canvas, scope, areaRequest);
		canvas.restore();
		return { ...result, drawn: true };
	}

	private renderDirect(request: FrameRequest): FrameResult {
		const scope = this.tracker.scope();
		let result = NOT_DRAWN;
		try {
			const drawn = this.surface.frame((canvas) => {
				const { source, view, devicePixelRatio } = request;
				canvas.clear(pageBackground(this.canvasKit, source));
				canvas.save();
				canvas.scale(devicePixelRatio, devicePixelRatio);
				this.lastSource = source;
				if (request.pixelPreview === true && view.scale > 1) {
					result = this.drawPixelPreview(canvas, scope, request);
				} else {
					result = this.drawScene(canvas, scope, request);
				}
				canvas.restore();
			});
			if (!drawn) return NOT_DRAWN;
			return result;
		} finally {
			scope.dispose();
		}
	}

	private drawScene(canvas: Canvas, scope: SkiaScope, request: FrameRequest): FrameResult {
		const { view } = request;
		canvas.save();
		canvas.translate(view.x, view.y);
		canvas.scale(view.scale, view.scale);
		const context = createDrawContext(this.canvasKit, canvas, scope, request, this.hooks, {
			needed: neededNodes(request),
			pictures: this.pictures
		});
		const result = drawScene(context);
		canvas.restore();
		return result;
	}

	/**
	 * Pixel preview: the page at one pixel per unit in a scratch surface whose pixel grid starts on
	 * a whole world coordinate, drawn magnified without smoothing so every pixel shows as a square.
	 */
	private drawPixelPreview(canvas: Canvas, scope: SkiaScope, request: FrameRequest): FrameResult {
		const { view, size } = request;
		const left = Math.floor(-view.x / view.scale);
		const top = Math.floor(-view.y / view.scale);
		const width = Math.ceil(size.width / view.scale) + 2;
		const height = Math.ceil(size.height / view.scale) + 2;
		const scratch = this.surface.makeScratchSurface(width, height);
		if (scratch === null) return this.drawScene(canvas, scope, request);
		try {
			const scratchRequest: FrameRequest = {
				...request,
				view: { x: -left, y: -top, scale: 1 },
				size: { width, height },
				devicePixelRatio: 1
			};
			const scratchCanvas = scratch.getCanvas();
			scratchCanvas.clear(pageBackground(this.canvasKit, request.source));
			const result = this.drawScene(scratchCanvas, scope, scratchRequest);
			scratch.flush();
			const image = scope.own(scratch.makeImageSnapshot());
			const target = Float32Array.of(
				left * view.scale + view.x,
				top * view.scale + view.y,
				(left + width) * view.scale + view.x,
				(top + height) * view.scale + view.y
			);
			canvas.drawImageRectOptions(
				image,
				Float32Array.of(0, 0, width, height),
				target,
				this.canvasKit.FilterMode.Nearest,
				this.canvasKit.MipmapMode.None,
				null
			);
			return result;
		} finally {
			scratch.delete();
		}
	}

	dispose(): void {
		this.snapshot.drop();
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
