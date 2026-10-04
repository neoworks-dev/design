// fonts: provides the `fonts` service (face list, missing-font resolution, byte loading). The
// CanvasKit font provider attaches to it through `ctx.fonts.attach(sink)`; this plugin does not
// depend on the renderer.

import type { Context } from '@neoworks/extension-system';
import { FontsState } from '../../lib/fonts/state.svelte';
import { FontsService, type FontsOptions } from './fonts';

declare module '@neoworks/extension-system' {
	interface Context {
		fonts: FontsService;
	}
}

export default {
	name: 'fonts',
	inject: ['desktop'],
	apply(ctx: Context, config: FontsOptions | undefined): void {
		const fonts = new FontsService(ctx, new FontsState(), config);
		ctx.effect(() => {
			// Without the list nothing is flagged missing; bundled Geist keeps text drawable.
			fonts
				.refresh()
				.catch((error: unknown) => ctx.logger.error('listing system fonts failed', error));
			return () => {};
		}, 'fonts:refresh');
	}
};
