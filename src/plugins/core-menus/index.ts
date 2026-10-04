import type { Context } from '@neoworks/extension-system';
import { MenusService } from '../../lib/registries/menus.svelte';
import MenuHost from './MenuHost.svelte';

// The `menus` service and the popup host that renders open menus in the `overlay` region.
export default {
	name: 'core-menus',
	inject: ['regions', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context): void {
		const menus = new MenusService(ctx, ctx.commands, ctx.keymap, ctx.contextKeys);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'core-menus/host',
					region: 'overlay',
					component: MenuHost
				}),
			'menus popup host'
		);

		// A popup must not outlive the window's focus: key-up and pointer events are lost.
		ctx.effect(() => {
			const close = (): void => menus.close();
			window.addEventListener('blur', close);
			window.addEventListener('resize', close);
			return () => {
				window.removeEventListener('blur', close);
				window.removeEventListener('resize', close);
			};
		}, 'menus/close-on-blur');
	}
};
