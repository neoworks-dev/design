import { Service, type Context } from '@neoworks/extension-system';
import type { Size } from '../../lib/kernel/types';
import type { SurfaceResetReason } from '../../lib/renderer/surface';
import { FrameScheduler, type FrameDriver } from '../../lib/renderer/frameScheduler';
import type { SceneChange, SceneSource } from '../../lib/renderer/sceneSource';
import {
	IDENTITY_VIEW,
	type FrameResult,
	type RenderBackend,
	type Renderer,
	type RendererStats,
	type ViewTransform
} from '../../lib/renderer/types';

declare module '@neoworks/extension-system' {
	interface Context {
		renderer: RendererService;
	}
}

/** Builds the backend that draws into `element`; tests substitute a recording fake. */
export type BackendFactory = (context: Context, element: HTMLCanvasElement) => RenderBackend;

interface CanvasTarget {
	element: HTMLCanvasElement;
	backend: RenderBackend;
	size: Size;
	devicePixelRatio: number;
}

const NO_RESULT: FrameResult = { drawn: false, drawnNodes: 0, layers: 0 };

function emptyStats(): RendererStats {
	return {
		frames: 0,
		lastFrameMilliseconds: 0,
		averageFrameMilliseconds: 0,
		lastReasons: [],
		lastResult: NO_RESULT,
		surfaceResets: 0
	};
}

/**
 * Draws the current SceneSource into the canvas the `canvas` region hosts.
 *
 * One frame per animation frame: scene changes, camera changes and surface resets all call
 * `requestFrame`, the scheduler coalesces them. The scene source is told about edits first (its
 * subscription runs synchronously inside the edit), the paint happens afterwards in the frame.
 */
export class RendererService extends Service implements Renderer {
	private source: SceneSource | undefined;
	private target: CanvasTarget | undefined;
	private viewProvider: () => ViewTransform = () => IDENTITY_VIEW;
	private readonly scheduler: FrameScheduler;
	private readonly frameStats = emptyStats();
	private totalFrameMilliseconds = 0;

	constructor(
		ctx: Context,
		driver: FrameDriver,
		private readonly createBackend: BackendFactory
	) {
		super(ctx, 'renderer');
		this.scheduler = new FrameScheduler(driver, (reasons) => this.drawFrame(reasons));
	}

	get stats(): RendererStats {
		return { ...this.frameStats, lastReasons: [...this.frameStats.lastReasons] };
	}

	get hasSceneSource(): boolean {
		return this.source !== undefined;
	}

	get hasCanvas(): boolean {
		return this.target !== undefined;
	}

	/** The source being drawn, for the plugins that query the same scene (spatial index). */
	get sceneSource(): SceneSource | undefined {
		return this.source;
	}

	get framePending(): boolean {
		return this.scheduler.isPending;
	}

	setSceneSource(source: SceneSource): () => void {
		const dispose = this.ctx.effect(() => {
			this.source = source;
			const unsubscribe = source.subscribe((change) => this.onSceneChange(change));
			this.requestFrame('scene-source');
			return () => {
				unsubscribe();
				if (this.source !== source) return;
				this.source = undefined;
				this.requestFrame('scene-source');
			};
		}, 'renderer/scene source');
		return () => void dispose();
	}

	/** Where the camera comes from; the viewport plugin sets it. Identity until then. */
	setViewProvider(provider: () => ViewTransform): () => void {
		const dispose = this.ctx.effect(() => {
			this.viewProvider = provider;
			this.requestFrame('viewport');
			return () => {
				if (this.viewProvider !== provider) return;
				this.viewProvider = () => IDENTITY_VIEW;
				this.requestFrame('viewport');
			};
		}, 'renderer/view provider');
		return () => void dispose();
	}

	/**
	 * Draws into `element` from now on. Called by the canvas component with its own context, so
	 * the surface and the registration are removed when that plugin unloads.
	 */
	attachCanvas(element: HTMLCanvasElement): () => void {
		const backend = this.createBackend(this.ctx, element);
		const disposeEffect = this.ctx.effect(() => {
			const target: CanvasTarget = {
				element,
				backend,
				size: { width: element.width, height: element.height },
				devicePixelRatio: 1
			};
			this.target = target;
			this.requestFrame('canvas attached');
			return () => {
				backend.dispose();
				if (this.target === target) this.target = undefined;
			};
		}, 'renderer/canvas');
		return () => void disposeEffect();
	}

	/** The canvas box changed size (CSS pixels) or the device pixel ratio did. */
	resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
		const target = this.target;
		if (!target) return;
		target.size = { width: cssWidth, height: cssHeight };
		target.devicePixelRatio = devicePixelRatio;
		const pixelWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
		const pixelHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
		target.backend.resize(pixelWidth, pixelHeight);
		this.requestFrame('resize');
	}

	requestFrame(reason: string): void {
		this.scheduler.request(reason);
	}

	/** Called by the plugin when the surface was rebuilt; everything drawn on it is gone. */
	noteSurfaceReset(reason: SurfaceResetReason): void {
		if (reason === 'context-restored') this.frameStats.surfaceResets += 1;
		this.requestFrame(reason);
	}

	/** Cancels the pending animation frame; the plugin calls it on unload. */
	stop(): void {
		this.scheduler.stop();
	}

	snapshotState(): { source: boolean; canvas: boolean; framePending: boolean } {
		return {
			source: this.source !== undefined,
			canvas: this.target !== undefined,
			framePending: this.scheduler.isPending
		};
	}

	private onSceneChange(_change: SceneChange): void {
		this.requestFrame('scene');
	}

	private drawFrame(reasons: string[]): void {
		const target = this.target;
		const source = this.source;
		if (!target || !source) return;
		const started = performance.now();
		let result = NO_RESULT;
		try {
			result = target.backend.render({
				source,
				view: this.viewProvider(),
				size: target.size,
				devicePixelRatio: target.devicePixelRatio
			});
		} catch (error) {
			this.ctx.logger.error(error);
		}
		this.recordFrame(reasons, result, performance.now() - started);
	}

	private recordFrame(reasons: string[], result: FrameResult, milliseconds: number): void {
		const stats = this.frameStats;
		stats.frames += 1;
		this.totalFrameMilliseconds += milliseconds;
		stats.lastFrameMilliseconds = milliseconds;
		stats.averageFrameMilliseconds = this.totalFrameMilliseconds / stats.frames;
		stats.lastReasons = reasons;
		stats.lastResult = result;
	}
}
