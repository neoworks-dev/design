import type { Context } from '@neoworks/extension-system';
import { HomeService } from '../../lib/services/home';
import { HomeState } from '../../lib/services/homeState.svelte';
import { MoveMenu, registerHomeCommands } from './homeCommands';
import { bindHomeKeys } from './homeKeys.svelte';
import HomeButton from './HomeButton.svelte';
import HomeScreen from './HomeScreen.svelte';

// The home screen: the Draftboard overview, like the Figma file browser. A sidebar with search,
// Recents, Drafts (the library files), library folders and linked folders; a main area with the
// files as a grid or list; context menus through the menus registry. It covers the window below
// the title bar at launch (nothing opens unless the launch named a file), when the last tab was
// closed, or when the Home button / `home.show` asks for it, and hides again once a file opens.
// Offline only: no teams, no sharing.
export default {
	name: 'home',
	inject: ['desktop', 'regions', 'commands', 'contextKeys', 'menus', 'errorUi'],
	apply(ctx: Context): void {
		const moveMenu = new MoveMenu(ctx);
		const home = new HomeService(ctx, ctx.desktop, ctx.contextKeys, new HomeState(), {
			report: (message) => ctx.errorUi.toast(message),
			onOverview: (overview) => moveMenu.rebuild(overview)
		});

		ctx.on('file/attached', () => home.hide());
		ctx.on('file/moved', () => {
			home.handleMoved().catch((error: unknown) => ctx.logger.error('home', error));
		});
		ctx.effect(() => () => home.hide(), 'home/hide on unmount');
		ctx.effect(() => () => moveMenu.dispose(), 'home/move menu');
		ctx.effect(() => bindHomeKeys(ctx.contextKeys, home), 'home/context keys');
		registerHomeCommands(ctx, home);

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
				ctx.commands.register({
					id: 'home.hide',
					title: 'Back to the open file',
					run: () => home.hide()
				}),
			'command home.hide'
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
