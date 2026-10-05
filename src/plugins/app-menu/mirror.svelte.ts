import type { NativeMenuItem } from '../../../electron/bridge';
import type { KeymapService } from '../../lib/registries/keymap.svelte';
import type { MenusService } from '../../lib/registries/menus.svelte';
import { toNativeItems } from './nativeMenu';

export const APP_MENU = 'app';

/**
 * Keep the native application menu equal to the resolved `app` menu: whenever an item, its
 * enabled or checked state or an accelerator changes, the whole tree is sent again. Unchanged
 * trees are not re-sent.
 */
export function mirrorMenuToNative(
	menus: MenusService,
	keymap: KeymapService,
	send: (items: NativeMenuItem[]) => Promise<void>,
	onError: (error: unknown) => void
): () => void {
	let lastSent = '';
	return $effect.root(() => {
		$effect(() => {
			const tree = toNativeItems(
				menus.resolve(APP_MENU),
				(command) => keymap.lookupChords(command)[0]
			);
			const serialised = JSON.stringify(tree);
			if (serialised === lastSent) return;
			lastSent = serialised;
			send(tree).catch(onError);
		});
	});
}
