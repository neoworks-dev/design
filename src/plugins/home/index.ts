import type { Context } from '@neoworks/extension-system';
import { HomeService } from '../../lib/services/home';
import { HomeState } from '../../lib/services/homeState.svelte';
import HomeButton from './HomeButton.svelte';
import HomeScreen from './HomeScreen.svelte';

// The home screen (#139): recent files with previews, drafts, search, sort, grid or list, New and
// Open. It covers the window below the title bar when no document is open (the last tab was
// closed) or when the Home button / `home.show` asks for it, and hides again once a file opens.
// Offline only: no teams, no sharing.
export default {
	name: 'home',
	inject: ['desktop', 'regions', 'commands', 'contextKeys'],
	apply(ctx: Context): void {
		const home = new HomeService(ctx, ctx.desktop, ctx.contextKeys, new HomeState());

		ctx.on('file/attached', () => home.hide());
		ctx.effect(() => () => home.hide(), 'home/hide on unmount');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'home.show',
					title: 'Go to home',
					run: () => home.show()
				}),
			'command home.show'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'home/screen',
					region: 'overlay',
					component: HomeScreen
				}),
			'home screen'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'home/button',
					region: 'top-bar',
					component: HomeButton,
					order: -2
				}),
			'home button'
		);
	}
};
