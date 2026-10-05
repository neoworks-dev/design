import type { Context } from '@neoworks/extension-system';
import { ShortcutsPanelService } from '../../lib/services/shortcutsPanel';
import { ShortcutsPanelState } from '../../lib/services/shortcutsPanelState.svelte';
import ShortcutsDialog from './ShortcutsDialog.svelte';

// The shortcut browser and editor (#133): every command grouped by category with its chords, search
// by command or chord, click a chord to record another one, reset one or all. Opens with
// Mod+Shift+/ (the "?" key). Rebinding goes through `shortcuts`, so it applies at once and is
// stored with the other settings.
export default {
	name: 'shortcuts-panel',
	inject: ['keymap', 'commands', 'shortcuts', 'regions', 'menus'],
	apply(ctx: Context): void {
		const panel = new ShortcutsPanelService(
			ctx,
			ctx.keymap,
			ctx.commands,
			ctx.shortcuts,
			new ShortcutsPanelState()
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'shortcuts-panel.toggle',
					title: 'Keyboard shortcuts',
					run: () => panel.toggle()
				}),
			'command shortcuts-panel.toggle'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Shift+/',
					command: 'shortcuts-panel.toggle',
					scope: 'global'
				}),
			'shortcut Mod+Shift+/ shortcuts panel'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/help',
					item: {
						id: 'keyboard-shortcuts',
						command: 'shortcuts-panel.toggle',
						group: '1_help',
						order: 5
					}
				}),
			'menu app/help keyboard-shortcuts'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'shortcuts-panel/dialog',
					region: 'overlay',
					component: ShortcutsDialog
				}),
			'shortcuts dialog'
		);

		// An open panel must not outlive the plugin.
		ctx.effect(() => () => panel.close(), 'shortcuts-panel/close on unload');
	}
};
