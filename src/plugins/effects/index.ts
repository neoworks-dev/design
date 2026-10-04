import type { Context } from '@neoworks/extension-system';
import { EFFECT_DRAW_HOOKS } from '../../lib/renderer/draw/effects';

// Effects for the renderer: drop and inner shadow, layer blur and background blur, registered as
// draw hooks (see lib/renderer/draw/effects.ts). Opacity, blend modes, masks and clip content are
// part of the scene drawer itself; they need no feature plugin.
export default {
	name: 'effects',
	inject: ['renderer'],
	apply(ctx: Context): void {
		ctx.effect(() => ctx.renderer.registerDrawHooks(EFFECT_DRAW_HOOKS), 'effects/draw hooks');
	}
};
