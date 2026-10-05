import { untrack } from 'svelte';
import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';
import type { PrototypeState } from '../../lib/services/prototypeState.svelte';

export const CONNECTION_SELECTED_KEY = 'prototypeConnectionSelected';

/**
 * Publish whether a connection arrow is selected, so Delete can remove it instead of the node.
 * Returns the stop function; meant to run inside `ctx.effect`.
 */
export function publishConnectionKey(
	state: PrototypeState,
	contextKeys: ContextKeysService
): () => void {
	let unpublish: (() => void) | undefined;
	const stop = $effect.root(() => {
		$effect(() => {
			const selected = state.selectedConnection !== null;
			const dispose = untrack(() => contextKeys.set(CONNECTION_SELECTED_KEY, selected));
			unpublish = dispose;
			return dispose;
		});
	});
	return () => {
		stop();
		unpublish?.();
	};
}
