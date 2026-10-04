import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId, Rect } from '../../lib/document/types';
import type { Size } from '../../lib/kernel/types';
import { SceneBounds } from '../../lib/renderer/bounds';
import type { SceneSource } from '../../lib/renderer/sceneSource';
import {
	DEFAULT_FIT,
	fitCamera,
	nextZoomStop,
	panCamera,
	screenToWorld,
	unionRects,
	visibleWorldRect,
	worldToScreen,
	zoomCameraAt,
	type Camera,
	type FitOptions,
	type ScreenPoint
} from '../../lib/viewport/camera';
import { wheelAction, type CanvasWheelEvent } from '../../lib/viewport/wheel';
import { ViewportState } from './state.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		viewport: ViewportService;
	}
}

export type SelectionProvider = () => readonly NodeId[];

const FRAME_TYPES = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'];

/**
 * The camera: where the canvas looks at the page, and every way to move it. Camera state is per
 * page (a page switch saves the camera of the page being left and restores the other's), in
 * float64 world units; the renderer reads it through `renderer.setViewProvider`.
 *
 * The scene comes from the renderer's scene source, the selection from a provider that the
 * selection service registers (`setSelectionProvider`), so this plugin depends on neither the
 * document nor the selection service.
 */
export class ViewportService extends Service {
	private selectionProvider: SelectionProvider = () => [];
	private lastFrameIndex: number | undefined;
	private cachedBounds: { source: SceneSource; bounds: SceneBounds; stop: () => void } | undefined;

	constructor(
		ctx: Context,
		private readonly state: ViewportState
	) {
		super(ctx, 'viewport');
	}

	// ---------- state ----------

	get camera(): Camera {
		return this.state.camera;
	}

	/** Scale: 1 is 100 percent. The debug surface reads this for `summary().zoom`. */
	get zoom(): number {
		return this.state.camera.scale;
	}

	get x(): number {
		return this.state.camera.x;
	}

	get y(): number {
		return this.state.camera.y;
	}

	get pageId(): NodeId | null {
		return this.state.pageId;
	}

	/** Canvas size in CSS pixels; falls back to what the renderer measured. */
	get size(): Size {
		if (this.state.size.width > 0) return this.state.size;
		return this.ctx.renderer.canvasSize;
	}

	worldToScreen(point: ScreenPoint): ScreenPoint {
		return worldToScreen(this.state.camera, point);
	}

	screenToWorld(point: ScreenPoint): ScreenPoint {
		return screenToWorld(this.state.camera, point);
	}

	/** The world rectangle currently on screen. */
	visibleRect(): Rect {
		return visibleWorldRect(this.state.camera, this.size);
	}

	/** Where the selection service says the selection is; set by it, empty until then. */
	setSelectionProvider(provider: SelectionProvider): () => void {
		const dispose = this.ctx.effect(() => {
			this.selectionProvider = provider;
			return () => {
				if (this.selectionProvider === provider) this.selectionProvider = () => [];
			};
		}, 'viewport/selection provider');
		return () => void dispose();
	}

	// ---------- moving the camera ----------

	setSize(size: Size): void {
		const current = this.state.size;
		if (current.width === size.width && current.height === size.height) return;
		this.state.setSize(size);
		this.applyPendingFit();
	}

	panBy(deltaX: number, deltaY: number): void {
		this.commit(panCamera(this.state.camera, deltaX, deltaY));
	}

	/** Zoom to `scale`, keeping the world point under `anchor` (canvas pixels) fixed. */
	zoomAt(anchor: ScreenPoint, scale: number): void {
		this.commit(zoomCameraAt(this.state.camera, anchor, scale));
	}

	zoomBy(factor: number, anchor: ScreenPoint): void {
		this.zoomAt(anchor, this.state.camera.scale * factor);
	}

	/** Zoom to `scale` around the middle of the canvas. */
	zoomTo(scale: number): void {
		this.zoomAt(this.canvasCentre(), scale);
	}

	/** One step up or down the zoom ladder, around the selection when there is one, else the centre. */
	stepZoom(direction: 'in' | 'out'): void {
		const scale = nextZoomStop(this.state.camera.scale, direction);
		this.zoomAt(this.zoomAnchor(), scale);
	}

	/** Frames `rect` with padding; the camera is centred on it. */
	zoomToRect(rect: Rect, options: FitOptions = DEFAULT_FIT): boolean {
		const size = this.size;
		if (size.width <= 0 || size.height <= 0) return false;
		if (rect.width <= 0 || rect.height <= 0) return false;
		this.commit(fitCamera(rect, size, options));
		return true;
	}

	/** Frames everything on the page; false while there is no content or no canvas size yet. */
	zoomToFit(): boolean {
		const source = this.sceneSource();
		if (!source) return false;
		const bounds = this.boundsFor(source).pageContentBounds();
		if (!bounds) return false;
		return this.zoomToRect(bounds);
	}

	/** Frames the given nodes (the selection by default); false when none of them has bounds. */
	zoomToSelection(ids: readonly NodeId[] = this.selectionProvider()): boolean {
		const bounds = this.boundsOf(ids);
		if (!bounds) return false;
		return this.zoomToRect(bounds);
	}

	/** Frames the next top-level frame of the page, wrapping around (key N). */
	nextFrame(): boolean {
		return this.stepFrame(1);
	}

	previousFrame(): boolean {
		return this.stepFrame(-1);
	}

	/** Called when the page shown changes: swaps the camera and fits a page seen for the first time. */
	setPage(pageId: NodeId | null): void {
		this.lastFrameIndex = undefined;
		this.state.switchPage(pageId);
		this.ctx.emit('viewport/change', this.state.camera);
		this.applyPendingFit();
	}

	/** Wheel and trackpad: pan, shift-wheel pans sideways, ctrl-wheel and pinch zoom to the cursor. */
	handleWheel(event: CanvasWheelEvent): void {
		event.preventDefault();
		const action = wheelAction(event, this.size);
		if (action.kind === 'pan') {
			this.panBy(action.deltaX, action.deltaY);
			return;
		}
		this.zoomBy(action.factor, action.anchor);
	}

	snapshotState(): ReturnType<ViewportState['snapshot']> {
		return this.state.snapshot();
	}

	// ---------- internals ----------

	private commit(camera: Camera): void {
		this.lastFrameIndex = undefined;
		this.state.setCamera(camera);
		this.ctx.emit('viewport/change', camera);
	}

	private sceneSource(): SceneSource | undefined {
		return this.ctx.renderer.sceneSource;
	}

	/** Cached bounds over `source`, kept valid by a subscription that unmounting removes. */
	private boundsFor(source: SceneSource): SceneBounds {
		if (this.cachedBounds && this.cachedBounds.source === source) return this.cachedBounds.bounds;
		if (this.cachedBounds) this.cachedBounds.stop();
		const bounds = new SceneBounds(source);
		const dispose = this.ctx.effect(() => {
			const unsubscribe = source.subscribe((notification) => bounds.handle(notification));
			return () => {
				unsubscribe();
			};
		}, 'viewport bounds cache');
		this.cachedBounds = { source, bounds, stop: () => void dispose() };
		return bounds;
	}

	private canvasCentre(): ScreenPoint {
		const size = this.size;
		return { x: size.width / 2, y: size.height / 2 };
	}

	private boundsOf(ids: readonly NodeId[]): Rect | null {
		const source = this.sceneSource();
		if (!source) return null;
		const rects: Rect[] = [];
		for (const id of ids) {
			const bounds = this.boundsFor(source).absoluteBoundsOf(id);
			if (bounds) rects.push(bounds);
		}
		return unionRects(rects);
	}

	private zoomAnchor(): ScreenPoint {
		const bounds = this.boundsOf(this.selectionProvider());
		if (!bounds) return this.canvasCentre();
		return this.worldToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
	}

	private applyPendingFit(): void {
		if (!this.state.pendingFit) return;
		if (this.zoomToFit()) this.state.pendingFit = false;
	}

	private topLevelFrames(): NodeId[] {
		const source = this.sceneSource();
		if (!source) return [];
		const pageId = source.currentPageId();
		if (pageId === null) return [];
		return source.children(pageId).filter((id) => {
			const node = source.getNode(id);
			return node !== undefined && node.type !== 'PAGE' && FRAME_TYPES.includes(node.type);
		});
	}

	private stepFrame(direction: 1 | -1): boolean {
		const frames = this.topLevelFrames();
		if (frames.length === 0) return false;
		const next = this.nextFrameIndex(frames, direction);
		const moved = this.zoomToSelection([frames[next]]);
		// After commit: any other camera move forgets the walk, so N then starts from what is nearest.
		if (moved) this.lastFrameIndex = next;
		return moved;
	}

	// After a jump the order continues from that frame; otherwise it starts from the frame nearest
	// to the middle of the canvas, so N from a manual pan goes to what is closest on screen.
	private nextFrameIndex(frames: NodeId[], direction: 1 | -1): number {
		const last = this.lastFrameIndex;
		if (last !== undefined && last < frames.length) {
			return (last + direction + frames.length) % frames.length;
		}
		const nearest = this.nearestFrameIndex(frames);
		return (nearest + direction + frames.length) % frames.length;
	}

	private nearestFrameIndex(frames: NodeId[]): number {
		const centre = this.screenToWorld(this.canvasCentre());
		let best = 0;
		let bestDistance = Infinity;
		frames.forEach((id, index) => {
			const bounds = this.boundsOf([id]);
			if (!bounds) return;
			const distance = Math.hypot(
				bounds.x + bounds.width / 2 - centre.x,
				bounds.y + bounds.height / 2 - centre.y
			);
			if (distance >= bestDistance) return;
			best = index;
			bestDistance = distance;
		});
		return best;
	}
}
