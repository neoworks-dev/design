import type { KeymapService, KeyOverrideSummary } from '../../lib/registries/keymap.svelte';

export interface SavedShortcuts {
	preset: string | undefined;
	overrides: KeyOverrideSummary[];
}

export function isOverride(value: unknown): value is KeyOverrideSummary {
	if (typeof value !== 'object' || value === null) return false;
	if (typeof Reflect.get(value, 'scope') !== 'string') return false;
	if (typeof Reflect.get(value, 'command') !== 'string') return false;
	const key: unknown = Reflect.get(value, 'key');
	return key === null || typeof key === 'string';
}

/** The overrides of a stored config that are well formed; anything else is dropped. */
export function overridesOfConfig(stored: unknown[]): KeyOverrideSummary[] {
	return stored.filter(isOverride);
}

/**
 * Report the preset and overrides whenever either changes. `onChange` is called with the new
 * state; the settings store persists it through the plugin's `fiber.update`.
 */
export function watchShortcuts(
	keymap: KeymapService,
	onChange: (state: SavedShortcuts) => void
): () => void {
	return $effect.root(() => {
		$effect(() => {
			onChange({ preset: keymap.preset, overrides: keymap.listOverrides() });
		});
	});
}
