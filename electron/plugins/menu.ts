// main-menu: the native application menu, mirrored from the renderer's menu bar.
//
// The renderer resolves its `app/*` menus (labels, accelerators from the keymap, enabled and
// checked state) and sends the tree over `menu:set` whenever it changes. This plugin turns it into
// a native menu template; a click is pushed back as `menu:command` and runs in the renderer, so
// the menu, the keymap and the palette all go through one command registry.
//
// Accelerators are shown but not registered (`registerAccelerator: false`): the renderer's keymap
// receives the key press, so a command never runs twice.

import type { Plugin } from '@neoworks/extension-system';
import type { NativeMenuItem } from '../bridge';
import type { HostMenuItem } from '../kernel/host';
import { route } from '../kernel/route';

export type CommandRunner = (command: string, args: unknown) => void;

function hostItemOf(item: NativeMenuItem, run: CommandRunner): HostMenuItem {
	if (item.submenu) {
		return {
			label: item.label,
			type: 'submenu',
			enabled: item.enabled,
			submenu: hostItemsOf(item.submenu, run)
		};
	}
	const { command, args } = item;
	return {
		label: item.label,
		type: item.checked ? 'checkbox' : 'normal',
		checked: item.checked,
		enabled: item.enabled && command !== undefined,
		accelerator: item.accelerator,
		registerAccelerator: false,
		click: () => {
			if (command !== undefined) run(command, args);
		}
	};
}

function hostItemsOf(items: NativeMenuItem[], run: CommandRunner): HostMenuItem[] {
	const result: HostMenuItem[] = [];
	for (const item of items) {
		if (item.separatorBefore) result.push({ type: 'separator' });
		result.push(hostItemOf(item, run));
	}
	return result;
}

/** The native template for a resolved menu bar; macOS gets its standard application menu first. */
export function buildHostMenu(
	items: NativeMenuItem[],
	platform: NodeJS.Platform,
	run: CommandRunner
): HostMenuItem[] {
	const template = hostItemsOf(items, run).filter((item) => item.type !== 'separator');
	if (platform !== 'darwin') return template;
	return [{ role: 'appMenu' }, ...template];
}

export const mainMenuPlugin: Plugin.Object = {
	name: 'main-menu',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		route(ctx, 'menu:set', (items, event) => {
			const window = ctx.electron.windowFromSender(event.sender);
			const run: CommandRunner = (command, args) => {
				if (window && !window.isDestroyed()) window.send('menu:command', { command, args });
			};
			ctx.electron.menu.setApplicationMenu(buildHostMenu(items, ctx.electron.app.platform, run));
		});
		ctx.effect(() => () => ctx.electron.menu.setApplicationMenu([]), 'main-menu/clear menu');
	}
};
