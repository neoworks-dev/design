// The drawing target of the renderer: a Skia surface on a WebGL canvas, a software fallback, or
// an offscreen raster surface (tests, headless export). One class, so the renderer neither knows
// nor cares which one it draws on.
//
// WebGL contexts can be lost at any time (GPU reset, too many contexts). The surface listens for
// `webglcontextlost` / `webglcontextrestored`, abandons the dead GrDirectContext, rebuilds
// everything on restore and reports it through `onReset` so the renderer can redraw.

import type { Canvas, CanvasKit, GrDirectContext, Surface } from 'canvaskit-wasm';
import type { SkiaTracker } from './ownership';

export type SurfaceKind = 'webgl' | 'software' | 'offscreen';
export type SurfaceResetReason = 'context-restored' | 'resize';

export interface SurfaceOptions {
	/** Skip WebGL; for environments without a GPU path. */
	preferSoftware?: boolean;
	onReset?: (reason: SurfaceResetReason) => void;
}

export interface PixelRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

const GL_ATTRIBUTES = {
	alpha: 1,
	depth: 1,
	stencil: 8,
	antialias: 0,
	premultipliedAlpha: 1,
	preserveDrawingBuffer: 0,
	preferLowPowerToHighPerformance: 0,
	failIfMajorPerformanceCaveat: 0,
	enableExtensionsByDefault: 1,
	majorVersion: 2
};

export class RenderSurface {
	private surface: Surface | null = null;
	private grContext: GrDirectContext | null = null;
	private glHandle = 0;
	private contextLost = false;
	private disposed = false;
	private cleanupListeners: (() => void) | undefined;

	private constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker,
		readonly kind: SurfaceKind,
		private readonly element: HTMLCanvasElement | undefined,
		private pixelWidth: number,
		private pixelHeight: number,
		private readonly options: SurfaceOptions
	) {}

	/** A surface drawing into `element`; its `width`/`height` attributes set the pixel size. */
	static forCanvas(
		canvasKit: CanvasKit,
		tracker: SkiaTracker,
		element: HTMLCanvasElement,
		options: SurfaceOptions = {}
	): RenderSurface {
		if (!options.preferSoftware) {
			const glSurface = new RenderSurface(
				canvasKit,
				tracker,
				'webgl',
				element,
				element.width,
				element.height,
				options
			);
			if (glSurface.buildGl()) {
				glSurface.listenForContextLoss();
				return glSurface;
			}
		}
		const software = new RenderSurface(
			canvasKit,
			tracker,
			'software',
			element,
			element.width,
			element.height,
			options
		);
		software.buildSoftware();
		return software;
	}

	/** A raster surface without a canvas element: works in Node. */
	static offscreen(
		canvasKit: CanvasKit,
		tracker: SkiaTracker,
		width: number,
		height: number
	): RenderSurface {
		const target = new RenderSurface(canvasKit, tracker, 'offscreen', undefined, width, height, {});
		target.buildOffscreen();
		return target;
	}

	get width(): number {
		return this.pixelWidth;
	}

	get height(): number {
		return this.pixelHeight;
	}

	/** True between `webglcontextlost` and `webglcontextrestored`: drawing is skipped. */
	get isLost(): boolean {
		return this.contextLost;
	}

	/** Draws one frame: `draw` gets the Skia canvas, the result is flushed to the screen. */
	frame(draw: (canvas: Canvas) => void): boolean {
		if (this.disposed || this.contextLost || this.surface === null) return false;
		draw(this.surface.getCanvas());
		this.surface.flush();
		return true;
	}

	resize(width: number, height: number): void {
		if (this.disposed) return;
		if (width === this.pixelWidth && height === this.pixelHeight) return;
		this.pixelWidth = width;
		this.pixelHeight = height;
		if (this.element) {
			this.element.width = width;
			this.element.height = height;
		}
		this.rebuildSurface();
		this.options.onReset?.('resize');
	}

	/** RGBA8888 unpremultiplied sRGB pixels of a region of the last flushed frame. */
	readPixels(region: PixelRegion): Uint8Array {
		const empty = new Uint8Array(region.width * region.height * 4);
		if (this.surface === null || this.contextLost) return empty;
		const image = this.surface.makeImageSnapshot();
		try {
			const pixels = image.readPixels(region.x, region.y, {
				width: region.width,
				height: region.height,
				colorType: this.canvasKit.ColorType.RGBA_8888,
				alphaType: this.canvasKit.AlphaType.Unpremul,
				colorSpace: this.canvasKit.ColorSpace.SRGB
			});
			if (pixels instanceof Uint8Array) return pixels;
			return empty;
		} finally {
			image.delete();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cleanupListeners?.();
		this.cleanupListeners = undefined;
		this.releaseSurface();
		this.releaseGl(false);
	}

	private buildGl(): boolean {
		if (!this.element) return false;
		const handle = this.canvasKit.GetWebGLContext(this.element, GL_ATTRIBUTES);
		if (handle === 0) return false;
		const grContext = this.canvasKit.MakeWebGLContext(handle);
		if (grContext === null) {
			this.canvasKit.deleteContext(handle);
			return false;
		}
		this.glHandle = handle;
		this.grContext = this.tracker.track(grContext);
		return this.buildGlSurface();
	}

	private buildGlSurface(): boolean {
		if (this.grContext === null) return false;
		const surface = this.canvasKit.MakeOnScreenGLSurface(
			this.grContext,
			this.pixelWidth,
			this.pixelHeight,
			this.canvasKit.ColorSpace.SRGB
		);
		if (surface === null) {
			this.releaseGl(false);
			return false;
		}
		this.surface = this.tracker.track(surface);
		return true;
	}

	private buildSoftware(): void {
		if (!this.element) throw new Error('software surface needs a canvas element');
		const surface = this.canvasKit.MakeSWCanvasSurface(this.element);
		if (surface === null) throw new Error('CanvasKit could not create a software surface');
		this.surface = this.tracker.track(surface);
	}

	private buildOffscreen(): void {
		const surface = this.canvasKit.MakeSurface(this.pixelWidth, this.pixelHeight);
		if (surface === null) throw new Error('CanvasKit could not create an offscreen surface');
		this.surface = this.tracker.track(surface);
	}

	private rebuildSurface(): void {
		this.releaseSurface();
		if (this.kind === 'webgl') {
			if (!this.contextLost) this.buildGlSurface();
			return;
		}
		if (this.kind === 'software') this.buildSoftware();
		else this.buildOffscreen();
	}

	private releaseSurface(): void {
		this.surface?.delete();
		this.surface = null;
	}

	/** `abandon` is true when the GL context is already dead and must not be touched. */
	private releaseGl(abandon: boolean): void {
		if (this.grContext) {
			if (abandon) this.grContext.releaseResourcesAndAbandonContext();
			this.grContext.delete();
			this.grContext = null;
		}
		if (this.glHandle !== 0) {
			this.canvasKit.deleteContext(this.glHandle);
			this.glHandle = 0;
		}
	}

	private listenForContextLoss(): void {
		const element = this.element;
		if (!element) return;
		const onLost = (event: Event): void => {
			// Without preventDefault the browser never restores the context.
			event.preventDefault();
			this.contextLost = true;
			this.releaseSurface();
			this.releaseGl(true);
		};
		const onRestored = (): void => {
			if (this.disposed) return;
			this.contextLost = false;
			if (!this.buildGl()) {
				this.contextLost = true;
				return;
			}
			this.options.onReset?.('context-restored');
		};
		element.addEventListener('webglcontextlost', onLost);
		element.addEventListener('webglcontextrestored', onRestored);
		this.cleanupListeners = () => {
			element.removeEventListener('webglcontextlost', onLost);
			element.removeEventListener('webglcontextrestored', onRestored);
		};
	}
}
