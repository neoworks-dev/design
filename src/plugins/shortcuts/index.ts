import type { Context } from '@neoworks/extension-system';
import { FIGMA_PRESET, PENPOT_PRESET } from './presets';
import { ShortcutsService } from './service';

// The user-facing shortcut system on top of `keymap`: the Figma and Penpot presets, rebinding
// with conflict detection and JSON export / import. Provides `shortcuts`. Switching preset or
// rebinding takes effect at once. What the user chose is kept by `shortcuts-store`.
export default {
	name: 'shortcuts',
	inject: ['keymap', 'commands'],
	apply(ctx: Context): void {
		const service = new ShortcutsService(ctx, ctx.keymap);

		for (const preset of [FIGMA_PRESET, PENPOT_PRESET]) {
			ctx.effect(() => ctx.keymap.registerPreset(preset), `shortcut preset ${preset.id}`);
			ctx.effect(
				() =>
					ctx.commands.register({
						id: `shortcuts.use-${preset.id}-preset`,
						title: `Keyboard shortcuts: use the ${preset.title} preset`,
						run: () => service.setPreset(preset.id)
					}),
				`command shortcuts.use-${preset.id}-preset`
			);
		}
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'shortcuts.reset-overrides',
					title: 'Keyboard shortcuts: reset all custom shortcuts',
					run: () => service.resetAll()
				}),
			'command shortcuts.reset-overrides'
		);
	}
};
