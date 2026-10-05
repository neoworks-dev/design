import type { Context } from '@neoworks/extension-system';
import { persistShortcuts, readSavedShortcuts, type ShortcutStorage } from './persistence.svelte';
import { FIGMA_PRESET, PENPOT_PRESET } from './presets';
import { ShortcutsService } from './service';

export interface ShortcutsConfig {
	/** Where the preset and user overrides persist. Defaults to localStorage. */
	storage?: ShortcutStorage;
}

function browserStorage(): ShortcutStorage | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	return localStorage;
}

// The user-facing shortcut system on top of `keymap`: the Figma and Penpot presets, rebinding
// with conflict detection, JSON export / import, and persistence of the choice and the overrides.
// Provides `shortcuts`. Switching preset or rebinding takes effect at once.
// There is no settings store yet (#131), so persistence goes straight to storage like the
// workbench layout; it moves to `settings` when that lands.
export default {
	name: 'shortcuts',
	inject: ['keymap', 'commands'],
	apply(ctx: Context, config?: ShortcutsConfig): void {
		const service = new ShortcutsService(ctx, ctx.keymap);
		const storage = config?.storage ?? browserStorage();

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

		if (!storage) return;
		const saved = readSavedShortcuts(storage);
		ctx.effect(() => service.restore(saved.overrides), 'shortcuts/restore overrides');
		ctx.effect(() => {
			const previous = ctx.keymap.preset;
			const wanted = saved.preset;
			if (wanted !== undefined && ctx.keymap.presets.has(wanted)) ctx.keymap.setPreset(wanted);
			return () => ctx.keymap.setPreset(previous);
		}, 'shortcuts/restore preset');
		ctx.effect(() => persistShortcuts(ctx.keymap, storage), 'shortcuts/persist');
	}
};
