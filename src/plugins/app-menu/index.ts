import type { Context } from '@neoworks/extension-system';
import { BAR_MENUS, DEFAULT_ITEMS } from './defaultItems';
import MenuBar from './MenuBar.svelte';
import { APP_MENU, mirrorMenuToNative } from './mirror.svelte';

// The menu bar: the `app` menu holds one submenu item per bar menu (`app/file`, `app/edit`,
// `app/view`, `app/object`, `app/plugins`, `app/help`), filled by any plugin. A bar menu without
// visible items is not shown, so `app/plugins` appears once a plugin adds to it.
//
// - Window: a `top-bar` contribution on Windows and Linux, where the frameless window has no
//   native menu bar. macOS shows the native menu bar instead.
// - Native: the resolved tree is mirrored to main (`menu:set`, plugin `main-menu`), which builds
//   the native application menu; clicks come back as `menu:command` and run through `commands`.
export default {
	name: 'app-menu',
	inject: ['menus', 'commands', 'keymap', 'regions', 'desktop'],
	apply(ctx: Context): void {
		BAR_MENUS.forEach((bar, position) => {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: APP_MENU,
						item: { id: bar.path, title: bar.title, submenu: bar.path, order: position }
					}),
				`menu app ${bar.path}`
			);
		});

		for (const item of DEFAULT_ITEMS) {
			const id = item.command === undefined ? item.submenu : item.command;
			if (id === undefined) continue;
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: item.menu,
						item: {
							id,
							command: item.command,
							title: item.title,
							submenu: item.submenu,
							group: item.group
						}
					}),
				`menu ${item.menu} ${id}`
			);
		}

		const showBar = ctx.desktop.platform !== 'darwin';
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'app-menu/bar',
					region: 'top-bar',
					component: MenuBar,
					order: -10,
					when: () => showBar
				}),
			'app menu bar'
		);

		ctx.desktop.on('menu:command', ({ command, args }) => {
			ctx.commands.run(command, args).catch((error: unknown) => ctx.logger.error(error));
		});

		if (!ctx.desktop.isNative) return;
		ctx.effect(
			() =>
				mirrorMenuToNative(
					ctx.menus,
					ctx.keymap,
					(items) => ctx.desktop.setNativeMenu(items),
					(error) => ctx.logger.error(error)
				),
			'app-menu/native mirror'
		);
	}
};
