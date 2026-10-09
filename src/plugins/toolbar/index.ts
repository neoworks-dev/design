import type { Context } from '@neoworks/extension-system';
import Toolbar from './Toolbar.svelte';
import { publishGroupMenus, ToolbarService, ToolbarState } from './service.svelte';

// The floating tool bar (region `toolbar`): one button per tool slot, where tools sharing a
// `toolbarGroup` collapse into the last-used member plus a dropdown, the menu buttons contributed
// to the `toolbar` menu (boolean operations), and the mode switch (buttons contributed through `toolbar.registerMode`). Provides `toolbar`.
export default {
	name: 'toolbar',
	inject: ['regions', 'tools', 'menus', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context): void {
		const toolbar = new ToolbarService(
			ctx,
			ctx.contextKeys,
			ctx.commands,
			ctx.tools,
			ctx.menus,
			new ToolbarState()
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'toolbar/bar',
					region: 'toolbar',
					component: Toolbar,
					when: () => ctx.tools.toolbarEntries().length > 0
				}),
			'toolbar bar'
		);

		ctx.effect(() => publishGroupMenus(ctx.tools, ctx.menus), 'toolbar/group menus');

		ctx.on('tools/change', (toolId) => toolbar.remember(toolId));
	}
};
