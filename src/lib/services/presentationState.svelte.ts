// Reactive holder behind the `presentation` service (a Service may not hold runes).

import type { PrototypeSession } from '../prototype/session.svelte';
import type { ScaleMode } from '../prototype/model';

/** Present fills the window (and the screen when it can); preview plays inside the canvas area. */
export type PresentationMode = 'present' | 'preview';

export class PresentationState {
	mode = $state.raw<PresentationMode | null>(null);
	session = $state.raw<PrototypeSession | null>(null);
	scaleMode = $state.raw<ScaleMode>('fit');
	/** Device chosen in the player's bar; `null` follows the page's prototype setting. */
	device = $state.raw<string | null>(null);
}
