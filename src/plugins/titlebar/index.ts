import type { Context } from '@neoworks/extension-system';
import { resolveDesktop } from '../../lib/kernel/desktop';
import { bindWindowTitle } from './documentTitle.svelte';
import Title from './Title.svelte';
import WindowControls from './WindowControls.svelte';

// The title bar of the frameless window: drag region with the document title, and the window
// controls (not on macOS, which keeps its traffic lights). Both are `top-bar` contributions, so
// another plugin can replace or extend either. The window commands go through the preload
// bridge (interim `resolveDesktop`, to become the `desktop` service of #16).
export default {
	name: 'titlebar',
	inject: ['regions', 'commands', 'contextKeys'],
	apply(ctx: Context): void {
		const desktop = resolveDesktop();
		const showControls = desktop?.system.platform !== 'darwin';

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.minimize',
					title: 'Minimize window',
					run: () => desktop?.window.minimize()
				}),
			'command titlebar.minimize'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.toggle-maximize',
					title: 'Maximize or restore window',
					run: async () => {
						await desktop?.window.toggleMaximize();
					}
				}),
			'command titlebar.toggle-maximize'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.close',
					title: 'Close window',
					run: () => desktop?.window.close()
				}),
			'command titlebar.close'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'titlebar/title',
					region: 'top-bar',
					component: Title,
					order: 0
				}),
			'titlebar title'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'titlebar/window-controls',
					region: 'top-bar',
					component: WindowControls,
					order: 100,
					when: () => showControls && desktop !== undefined
				}),
			'titlebar window controls'
		);

		ctx.effect(() => bindWindowTitle(ctx.contextKeys), 'titlebar/window-title');
	}
};
