import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { updateConfig } from '../../lib/settings/updateConfig';
import { overridesOfConfig, watchShortcuts, type SavedShortcuts } from './persistence.svelte';
import { FIGMA_PRESET, PENPOT_PRESET } from './presets';
import { ShortcutsService } from './service';

// The plugin's settings, stored by main through the settings plugin. Neither is shown in the
// generated Settings form: the shortcut editor edits them. `overrides` is checked entry by entry
// when it is applied, so the schema only says it is a list.
const shortcutsConfigSchema = z
	.object({
		preset: z.string().default('figma').meta({ hidden: true }),
		overrides: z.array(z.unknown()).default([]).meta({ hidden: true })
	})
	.prefault({});
export type ShortcutsConfig = z.infer<typeof shortcutsConfigSchema>;

function sameState(config: ShortcutsConfig, state: SavedShortcuts): boolean {
	if (config.preset !== state.preset) return false;
	return JSON.stringify(config.overrides) === JSON.stringify(state.overrides);
}

// The user-facing shortcut system on top of `keymap`: the Figma and Penpot presets, rebinding
// with conflict detection, JSON export / import, and persistence of the choice and the overrides.
// Provides `shortcuts`. Switching preset or rebinding takes effect at once.
// The choice and the overrides are the plugin's `Config`: a change calls `fiber.update`, which the
// settings plugin persists, and the restart applies them again from the config.
export default {
	name: 'shortcuts',
	inject: ['keymap', 'commands'],
	Config: shortcutsConfigSchema,
	apply(ctx: Context, config: ShortcutsConfig): void {
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

		ctx.effect(
			() => service.restore(overridesOfConfig(config.overrides)),
			'shortcuts/restore overrides'
		);
		ctx.effect(() => {
			const previous = ctx.keymap.preset;
			const wanted = config.preset;
			if (wanted !== undefined && ctx.keymap.presets.has(wanted)) ctx.keymap.setPreset(wanted);
			return () => ctx.keymap.setPreset(previous);
		}, 'shortcuts/restore preset');
		ctx.effect(
			() =>
				watchShortcuts(ctx.keymap, (state) => {
					if (sameState(config, state)) return;
					// Restarting inside the effect that noticed the change would loop through it.
					void Promise.resolve()
						.then(() => updateConfig(ctx.fiber, state))
						.catch((error: unknown) => ctx.logger.error('shortcuts', error));
				}),
			'shortcuts/persist'
		);
	}
};
