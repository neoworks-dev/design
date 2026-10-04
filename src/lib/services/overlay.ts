// The `overlay` service: screen-space drawing above the scene, contributed by plugins.
//
//   ctx.effect(() => ctx.overlay.register({ id: 'my/guides', order: 10, draw }), 'my guides')
//
// The host component attaches a 2D canvas (`attachCanvas`) and sizes it. Redraws are coalesced to
// one per animation frame: registering or disposing a contribution, a camera change and the other
// kernel events the plugin listens to all call `requestRedraw`.

import { Service, type Context } from '@neoworks/extension-system';
import type { Rect } from '../document/types';
import type { Size } from '../kernel/types';
import type { OverlayContribution, OverlayFrame } from '../overlay/types';
import { FrameScheduler, type FrameDriver } from '../renderer/frameScheduler';
import { Registry } from '../registries/registry.svelte';
import type { Camera, ScreenPoint } from '../viewport/camera';

declare module '@neoworks/extension-system' {
	interface Context {
		overlay: OverlayService;
	}
}

export class OverlayRegistry extends Registry<OverlayContribution> {}

interface OverlayTarget {
	canvas: HTMLCanvasElement;
	size: Size;
	devicePixelRatio: number;
}

export class OverlayService extends Service {
	readonly registry = new OverlayRegistry();
	private target: OverlayTarget | undefined;
	private readonly scheduler: FrameScheduler;
	private paintedFrames = 0;

	constructor(
		ctx: Context,
		driver: FrameDriver,
		private readonly camera: () => Camera
	) {
		super(ctx, 'overlay');
		this.scheduler = new FrameScheduler(driver, () => this.paint());
	}

	/** Frames painted so far (tests and the debug surface). */
	get frames(): number {
		return this.paintedFrames;
	}

	get framePending(): boolean {
		return this.scheduler.isPending;
	}

	register(contribution: OverlayContribution): () => void {
		const dispose = this.registry.register(contribution);
		this.requestRedraw('register');
		return () => {
			dispose();
			this.requestRedraw('dispose');
		};
	}

	/** Reactive: the contributions in drawing order. */
	contributions(): readonly OverlayContribution[] {
		return this.registry.list();
	}

	requestRedraw(reason: string): void {
		this.scheduler.request(reason);
	}

	/** Draws on `canvas` from now on; the disposer detaches it. */
	attachCanvas(canvas: HTMLCanvasElement): () => void {
		const target: OverlayTarget = {
			canvas,
			size: { width: canvas.clientWidth, height: canvas.clientHeight },
			devicePixelRatio: 1
		};
		const dispose = this.ctx.effect(() => {
			this.target = target;
			this.requestRedraw('attach');
			return () => {
				if (this.target === target) this.target = undefined;
			};
		}, 'overlay/canvas');
		return () => void dispose();
	}

	resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
		const target = this.target;
		if (!target) return;
		target.size = { width: cssWidth, height: cssHeight };
		target.devicePixelRatio = devicePixelRatio;
		target.canvas.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
		target.canvas.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
		this.requestRedraw('resize');
	}

	stop(): void {
		this.scheduler.stop();
	}

	snapshotState(): { canvas: boolean; framePending: boolean } {
		return { canvas: this.target !== undefined, framePending: this.scheduler.isPending };
	}

	/** Paints every contribution, lowest order first; a throwing one does not stop the rest. */
	paint(): void {
		const target = this.target;
		if (!target) return;
		const context = target.canvas.getContext('2d');
		if (!context) return;
		const frame = this.frameFor(context, target);
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, target.canvas.width, target.canvas.height);
		for (const contribution of this.registry.list()) {
			context.save();
			context.scale(target.devicePixelRatio, target.devicePixelRatio);
			try {
				contribution.draw(frame);
			} catch (error) {
				this.ctx.logger.error(error);
			}
			context.restore();
		}
		this.paintedFrames += 1;
	}

	private frameFor(context: CanvasRenderingContext2D, target: OverlayTarget): OverlayFrame {
		const camera = this.camera();
		const toScreen = (point: ScreenPoint): ScreenPoint => ({
			x: point.x * camera.scale + camera.x,
			y: point.y * camera.scale + camera.y
		});
		return {
			ctx: context,
			camera,
			size: target.size,
			devicePixelRatio: target.devicePixelRatio,
			worldToScreen: toScreen,
			worldRectToScreen: (rect: Rect): Rect => {
				const origin = toScreen({ x: rect.x, y: rect.y });
				return {
					x: origin.x,
					y: origin.y,
					width: rect.width * camera.scale,
					height: rect.height * camera.scale
				};
			}
		};
	}
}
