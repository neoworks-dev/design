import type { Context } from '@neoworks/extension-system';
import { contributeCommand } from '../../lib/editing/contribute';
import { PixelGridService } from '../../lib/services/pixelGrid';
import { PixelGridState } from '../../lib/services/pixelGridState.svelte';
import { drawPixelGrid } from '../../lib/viewport/pixelGrid';

// The pixel grid (one-pixel lines from 800% zoom, Mod+') and pixel preview (1x render magnified
// without smoothing, Mod+Shift+P), both under View. Key chords are tagged [K] in
// docs/research/interactions.md: unverified against Figma.
export default {
	name: 'pixel-grid',
	inject: ['overlay', 'viewport', 'renderer', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		const state = new PixelGridState();
		const service = new PixelGridService(ctx, state);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'pixel-grid/grid',
					order: 10,
					track: () => void service.gridEnabled,
					draw: (frame) => {
						if (service.gridEnabled) drawPixelGrid(frame);
					}
				}),
			'pixel-grid/overlay'
		);
		// pixel preview is renderer state outside this plugin: switch it off again on unload
		ctx.effect(() => () => ctx.renderer.setPixelPreview(false), 'pixel-grid/restore preview');

		contributeCommand(ctx, {
			id: 'view.toggle-pixel-grid',
			title: 'Pixel grid',
			keys: ["Mod+'"],
			run: () => service.toggleGrid(),
			menus: [{ menu: 'app/view', group: '5_pixels', order: 1 }]
		});
		contributeCommand(ctx, {
			id: 'view.toggle-pixel-preview',
			title: 'Pixel preview',
			keys: ['Mod+Shift+P'],
			run: () => service.togglePreview(),
			menus: [{ menu: 'app/view', group: '5_pixels', order: 2 }]
		});
	}
};
