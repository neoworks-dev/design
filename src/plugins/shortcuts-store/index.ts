import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { updateConfig } from '../../lib/settings/updateConfig';
import { overridesOfConfig, watchShortcuts, type SavedShortcuts } from './persistence.svelte';

// What the user chose, stored by main through the settings plugin. Neither key is shown in the
// generated Settings form: the shortcut editor edits them. `overrides` is checked entry by entry
// when it is applied, so the schema only says it is a list.
const shortcutsStoreConfigSchema = z
	.object({
		preset: z.string().default('figma').meta({ hidden: true }),
		overrides: z.array(z.unknown()).default([]).meta({ hidden: true })
	})
	.prefault({});
export type ShortcutsStoreConfig = z.infer<typeof shortcutsStoreConfigSchema>;

function sameState(config: ShortcutsStoreConfig, state: SavedShortcuts): boolean {
	if (config.preset !== state.preset) return false;
	return JSON.stringify(config.overrides) === JSON.stringify(state.overrides);
}

// Keeps the active shortcut preset and the user's overrides across sessions. They are this
// plugin's `Config`: a change calls `fiber.update`, which the settings plugin persists, and the
// restart that follows applies them again from the config. A plugin of its own so that restarting
// it does not restart `shortcuts` and everything injecting that (the shortcut panel stays open
// while a chord is rebound).
export default {
	name: 'shortcuts-store',
	inject: ['keymap', 'shortcuts'],
	Config: shortcutsStoreConfigSchema,
	apply(ctx: Context, config: ShortcutsStoreConfig): void {
		ctx.effect(
			() => ctx.shortcuts.restore(overridesOfConfig(config.overrides)),
			'shortcuts-store/restore overrides'
		);
		ctx.effect(() => {
			const previous = ctx.keymap.preset;
			const wanted = config.preset;
			if (wanted !== undefined && ctx.keymap.presets.has(wanted)) ctx.keymap.setPreset(wanted);
			return () => ctx.keymap.setPreset(previous);
		}, 'shortcuts-store/restore preset');
		ctx.effect(
			() =>
				watchShortcuts(ctx.keymap, (state) => {
					if (sameState(config, state)) return;
					// Restarting inside the effect that noticed the change would loop through it.
					void Promise.resolve()
						.then(() => updateConfig(ctx.fiber, state))
						.catch((error: unknown) => ctx.logger.error('shortcuts-store', error));
				}),
			'shortcuts-store/persist'
		);
	}
};
