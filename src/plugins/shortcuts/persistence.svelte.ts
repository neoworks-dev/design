import type { KeymapService, KeyOverrideSummary } from '../../lib/registries/keymap.svelte';

export const SHORTCUTS_STORAGE_KEY = 'shortcuts/state';

export interface ShortcutStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface SavedShortcuts {
	preset: string | undefined;
	overrides: KeyOverrideSummary[];
}

function isOverride(value: unknown): value is KeyOverrideSummary {
	if (typeof value !== 'object' || value === null) return false;
	if (typeof Reflect.get(value, 'scope') !== 'string') return false;
	if (typeof Reflect.get(value, 'command') !== 'string') return false;
	const key: unknown = Reflect.get(value, 'key');
	return key === null || typeof key === 'string';
}

/** What the last session stored; anything unreadable counts as nothing stored. */
export function readSavedShortcuts(storage: ShortcutStorage): SavedShortcuts {
	const empty: SavedShortcuts = { preset: undefined, overrides: [] };
	const raw = storage.getItem(SHORTCUTS_STORAGE_KEY);
	if (raw === null) return empty;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return empty;
		const preset: unknown = Reflect.get(parsed, 'preset');
		const overrides: unknown = Reflect.get(parsed, 'overrides');
		const saved: SavedShortcuts = { preset: undefined, overrides: [] };
		if (typeof preset === 'string') saved.preset = preset;
		if (Array.isArray(overrides)) saved.overrides = overrides.filter(isOverride);
		return saved;
	} catch {
		return empty;
	}
}

/** Write the preset and overrides to storage whenever either changes. */
export function persistShortcuts(keymap: KeymapService, storage: ShortcutStorage): () => void {
	return $effect.root(() => {
		$effect(() => {
			const state: SavedShortcuts = {
				preset: keymap.preset,
				overrides: keymap.listOverrides()
			};
			storage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(state));
		});
	});
}
