// Context keys the home screen publishes while it is visible, so other plugins can react without
// importing it: `home.directory` (where File > New creates a file; empty for Recents and while
// the home screen is hidden) and `home.recents` (menu items that only apply to the recent list).

import { untrack } from 'svelte';
import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';
import type { HomeService } from '../../lib/services/home';

export const HOME_DIRECTORY_KEY = 'home.directory';
export const HOME_RECENTS_KEY = 'home.recents';

/** Keep the keys current; returns the stop function that also unsets them. */
export function bindHomeKeys(contextKeys: ContextKeysService, home: HomeService): () => void {
	let unsetDirectory = (): void => {};
	let unsetRecents = (): void => {};
	// Publishing writes the registry that `home.visible` reads, so a key is only written when its
	// value changed; otherwise the effect would trigger itself forever.
	let publishedDirectory: string | undefined;
	let publishedRecents: boolean | undefined;
	const stop = $effect.root(() => {
		$effect(() => {
			const directory = home.currentDirectory;
			let value = '';
			if (directory !== undefined) value = directory;
			untrack(() => {
				if (value === publishedDirectory) return;
				publishedDirectory = value;
				unsetDirectory = contextKeys.set(HOME_DIRECTORY_KEY, value);
			});
		});
		$effect(() => {
			const inRecents = home.inRecents;
			untrack(() => {
				if (inRecents === publishedRecents) return;
				publishedRecents = inRecents;
				unsetRecents = contextKeys.set(HOME_RECENTS_KEY, inRecents);
			});
		});
	});
	return () => {
		stop();
		unsetDirectory();
		unsetRecents();
	};
}
