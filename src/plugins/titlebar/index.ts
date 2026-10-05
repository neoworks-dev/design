import type { Context } from '@neoworks/extension-system';
import { bindWindowTitle } from './documentTitle.svelte';
import Title from './Title.svelte';
import WindowControls from './WindowControls.svelte';

export const MAXIMIZED_KEY = 'window.maximized';

// The title bar of the frameless window: drag region with the document title, and the window
// controls (not on macOS, which keeps its traffic lights, and not in a plain browser). Both are
// `top-bar` contributions, so another plugin can replace or extend either. The window commands
// go through the `desktop` service. Whether the window is maximized is the context key
// `window.maximized`, seeded from main and kept current by the `window:maximized` push, so the
// maximize button swaps to a restore icon and menus can use it in a `when`.
export default {
	name: 'titlebar',
	inject: ['regions', 'commands', 'contextKeys', 'desktop'],
	apply(ctx: Context): void {
		const showControls = ctx.desktop.isNative && ctx.desktop.platform !== 'darwin';

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.minimize',
					title: 'Minimize window',
					run: () => ctx.desktop.minimizeWindow()
				}),
			'command titlebar.minimize'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.toggle-maximize',
					title: 'Maximize or restore window',
					run: async () => {
						await ctx.desktop.toggleMaximizeWindow();
					}
				}),
			'command titlebar.toggle-maximize'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.close',
					title: 'Close window',
					run: () => ctx.desktop.closeWindow()
				}),
			'command titlebar.close'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'titlebar.rename',
					title: 'Rename file in the title bar',
					run: () => {
						ctx.contextKeys.set('titlebar.renaming', true);
					}
				}),
			'command titlebar.rename'
		);
		ctx.effect(() => {
			const unset = ctx.contextKeys.set('titlebar.renaming', false);
			return () => unset();
		}, 'titlebar/renaming key');

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
					when: () => showControls
				}),
			'titlebar window controls'
		);

		ctx.effect(() => bindWindowTitle(ctx.contextKeys), 'titlebar/window-title');

		// Each publish replaces the key's entry, so only the newest disposer unsets it.
		let unsetMaximized: () => void = () => {};
		const publishMaximized = (maximized: boolean): void => {
			unsetMaximized = ctx.contextKeys.set(MAXIMIZED_KEY, maximized);
		};
		ctx.effect(() => {
			publishMaximized(false);
			return () => unsetMaximized();
		}, 'titlebar/window.maximized key');
		ctx.desktop.on('window:maximized', publishMaximized);
		ctx.effect(() => {
			let live = true;
			ctx.desktop
				.isWindowMaximized()
				.then((maximized) => {
					if (live) publishMaximized(maximized);
				})
				.catch((error: unknown) => ctx.logger.error(error));
			return () => {
				live = false;
			};
		}, 'titlebar/initial maximized state');
	}
};
