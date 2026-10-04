import { Service, type Context } from '@neoworks/extension-system';
import type { CanvasKit } from 'canvaskit-wasm';
import { loadCanvasKit, type WasmLocator } from '../../lib/render/canvaskit';
import { SkiaTracker, type Deletable } from '../../lib/render/ownership';
import { RenderSurface, type SurfaceOptions } from '../../lib/render/surface';

declare module '@neoworks/extension-system' {
	interface Context {
		canvaskit: CanvasKitService;
	}
}

/**
 * The loaded CanvasKit module plus the rules for owning what it creates.
 *
 * Plugins that draw ask for their surface here (`createSurface`) and register every Skia object
 * they keep through `own` (deleted when the calling plugin unloads) or `tracker` (counted, deleted
 * by the holder). `tracker.liveCount` is the leak counter.
 */
export class CanvasKitService extends Service {
	readonly tracker = new SkiaTracker();
	private loaded: CanvasKit | undefined;

	constructor(
		ctx: Context,
		private readonly locateFile: WasmLocator
	) {
		super(ctx, 'canvaskit');
	}

	/** Loads the wasm. The plugin awaits this before it counts as active, so dependents wait. */
	async [Service.init](): Promise<void> {
		this.loaded = await loadCanvasKit(this.locateFile);
	}

	get isReady(): boolean {
		return this.loaded !== undefined;
	}

	get kit(): CanvasKit {
		if (!this.loaded) throw new Error('CanvasKit is not loaded yet');
		return this.loaded;
	}

	/**
	 * A surface drawing into `element` (WebGL, software when there is no GPU). It is deleted when
	 * the calling plugin unloads; `onReset` fires after a context restore or resize rebuilt it.
	 */
	createSurface(element: HTMLCanvasElement, options: SurfaceOptions = {}): RenderSurface {
		let surface: RenderSurface | undefined;
		this.ctx.effect(() => {
			const created = RenderSurface.forCanvas(this.kit, this.tracker, element, {
				...options,
				onReset: (reason) => {
					options.onReset?.(reason);
					this.ctx.emit('renderer/surface-reset', reason);
				}
			});
			surface = created;
			return () => created.dispose();
		}, 'canvaskit/surface');
		if (!surface) throw new Error('surface effect did not run');
		return surface;
	}

	/** A raster surface without a canvas element (tests, export). */
	createOffscreenSurface(width: number, height: number): RenderSurface {
		let surface: RenderSurface | undefined;
		this.ctx.effect(() => {
			const created = RenderSurface.offscreen(this.kit, this.tracker, width, height);
			surface = created;
			return () => created.dispose();
		}, 'canvaskit/offscreen surface');
		if (!surface) throw new Error('surface effect did not run');
		return surface;
	}

	/** Keeps `create()`'s object alive until the calling plugin unloads, then deletes it. */
	own<T extends Deletable>(label: string, create: () => T): T {
		let owned: T | undefined;
		this.ctx.effect(() => {
			const created = this.tracker.track(create());
			owned = created;
			return () => created.delete();
		}, label);
		if (!owned) throw new Error(`effect "${label}" did not run`);
		return owned;
	}

	snapshotState(): { liveObjects: number } {
		return { liveObjects: this.tracker.liveCount };
	}
}
