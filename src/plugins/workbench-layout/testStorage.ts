import type { LayoutStorage } from './layoutState.svelte';

export interface MemoryStorage extends LayoutStorage {
	values: Record<string, string>;
}

/** In-memory stand-in for localStorage in tests. */
export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
	const values = { ...initial };
	return {
		values,
		getItem: (key) => values[key] ?? null,
		setItem: (key, value) => {
			values[key] = value;
		}
	};
}
