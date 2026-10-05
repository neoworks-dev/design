import { untrack } from 'svelte';
import type { ContextKeysService } from '../../lib/registries/contextKeys.svelte';
import type { PresentationState } from '../../lib/services/presentationState.svelte';

export const PRESENTING_KEY = 'presenting';

/** Publish whether a presentation is open. Returns the stop function; run it inside `ctx.effect`. */
export function publishPresentingKey(
	state: PresentationState,
	contextKeys: ContextKeysService
): () => void {
	let unpublish: (() => void) | undefined;
	const stop = $effect.root(() => {
		$effect(() => {
			const presenting = state.mode !== null;
			const dispose = untrack(() => contextKeys.set(PRESENTING_KEY, presenting));
			unpublish = dispose;
			return dispose;
		});
	});
	return () => {
		stop();
		unpublish?.();
	};
}
