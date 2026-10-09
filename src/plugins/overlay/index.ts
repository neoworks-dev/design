import type { Context } from '@neoworks/extension-system';
import { animationFrameDriver, type FrameDriver } from '../../lib/renderer/frameScheduler';
import { OverlayService } from '../../lib/services/overlay';
import OverlayHost from './OverlayHost.svelte';

export interface OverlayConfig {
	/** Frame source; tests drive frames by hand. Defaults to requestAnimationFrame. */
	frameDriver?: FrameDriver;
}

// Events that change what overlays show without the contributor asking: the camera, the
// selection, the active tool, the page (the renderer announces it late, so the document event
// counts too) and the document. Contributors with other inputs use
// `track` (reactive state) or call `ctx.overlay.requestRedraw`.
const REDRAW_EVENTS = [
	'viewport/change',
	'canvas/resize',
	'selection/change',
	'tools/change',
	'scene/page-change',
	'document/currentpagechange',
	'document/change',
	'document/replace'
] as const;

// Provides `overlay`: the registry plus the 2D canvas host in `canvas-overlay`. See
// src/lib/overlay/types.ts for the drawing model.
export default {
	name: 'overlay',
	inject: ['regions', 'viewport'],
	apply(ctx: Context, config?: OverlayConfig): void {
		const driver = config?.frameDriver ?? animationFrameDriver;
		const overlay = new OverlayService(ctx, driver, () => ctx.viewport.camera);
		ctx.effect(() => () => overlay.stop(), 'overlay/frame loop');
		for (const event of REDRAW_EVENTS) {
			ctx.on(event, () => overlay.requestRedraw(event));
		}
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'overlay/canvas',
					region: 'canvas-overlay',
					component: OverlayHost,
					order: -100
				}),
			'overlay canvas'
		);
	}
};
