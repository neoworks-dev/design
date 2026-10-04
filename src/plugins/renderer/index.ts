import type { Context } from '@neoworks/extension-system';
import { CanvasKitBackend } from '../../lib/renderer/canvaskitBackend';
import { animationFrameDriver, type FrameDriver } from '../../lib/renderer/frameScheduler';
import CanvasHost from './CanvasHost.svelte';
import { RendererService, type BackendFactory } from './service';

export interface RendererConfig {
	/** Frame source; tests drive frames by hand. Defaults to requestAnimationFrame. */
	frameDriver?: FrameDriver;
	/** Backend factory; tests substitute a recording fake. Defaults to CanvasKit on `canvaskit`. */
	createBackend?: BackendFactory;
}

const canvasKitBackend: BackendFactory = (ctx, element) => {
	const { kit, tracker } = ctx.canvaskit;
	const surface = ctx.canvaskit.createSurface(element);
	return new CanvasKitBackend(kit, tracker, surface);
};

// Provides `renderer` and fills the `canvas` region with the canvas it draws on. The scene comes
// from a SceneSource that another plugin hands over (`renderer.setSceneSource`), see
// src/lib/renderer/sceneSource.ts for the seam to the document service.
export default {
	name: 'renderer',
	inject: ['regions', 'canvaskit'],
	apply(ctx: Context, config?: RendererConfig): void {
		const driver = config?.frameDriver ?? animationFrameDriver;
		const createBackend = config?.createBackend ?? canvasKitBackend;
		const renderer = new RendererService(ctx, driver, createBackend);

		ctx.effect(() => () => renderer.stop(), 'renderer/frame loop');

		ctx.on('renderer/surface-reset', (reason) => renderer.noteSurfaceReset(reason));
		ctx.on('renderer/need-frame', (reason) => renderer.requestFrame(reason));

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'renderer/canvas',
					region: 'canvas',
					component: CanvasHost
				}),
			'renderer canvas'
		);
	}
};
