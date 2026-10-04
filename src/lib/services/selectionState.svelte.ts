// Reactive holder behind the `selection` service (a Service may not hold runes).

import { SvelteMap } from 'svelte/reactivity';
import type { NodeId } from '../document';

export interface PageSelectionMemory {
	ids: readonly NodeId[];
	scopeId: NodeId | null;
}

export class SelectionState {
	ids = $state.raw<readonly NodeId[]>([]);
	/** Container whose children are single-click selectable; `null` until a page is known. */
	scopeId = $state.raw<NodeId | null>(null);
	hoverId = $state.raw<NodeId | null>(null);
	/** What each page had selected when it was left. */
	readonly memory = new SvelteMap<NodeId, PageSelectionMemory>();
}
