import type { Context } from '@neoworks/extension-system';
import { createCommandsSource } from './commandsSource';
import Palette from './Palette.svelte';
import { PaletteService } from './service';
import { PaletteState } from './state.svelte';

// The command palette: a searchable list of every command, plus whatever sources other plugins
// register through `palette.registerSource` (pages and layers come from `palette-sources`).
// Opens with Mod+K or Mod+/, Arrows move, Enter runs, Esc closes, Tab switches source. Provides
// `palette`.
export default {
	name: 'command-palette',
	inject: ['commands', 'keymap', 'regions', 'contextKeys'],
	apply(ctx: Context): void {
		const palette = new PaletteService(ctx, new PaletteState());

		ctx.effect(
			() => palette.registerSource(createCommandsSource(palette, ctx.commands, ctx.keymap)),
			'palette source commands'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'command-palette/dialog',
					region: 'overlay',
					component: Palette
				}),
			'palette dialog'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'palette.toggle',
					title: 'Show command palette',
					run: () => palette.toggle()
				}),
			'command palette.toggle'
		);
		for (const key of ['Mod+K', 'Mod+/']) {
			ctx.effect(
				() => ctx.keymap.register({ key, command: 'palette.toggle', scope: 'global' }),
				`shortcut ${key} palette`
			);
		}

		// An open palette must not outlive the plugin.
		ctx.effect(() => () => palette.close(), 'palette/close on unload');
	}
};
