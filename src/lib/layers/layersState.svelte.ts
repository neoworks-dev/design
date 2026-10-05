// Reactive holder behind the `layers` service (a Service may not hold runes): which containers
// are expanded, which row is being renamed and the filter. Panel state, not document state: it
// is not undoable and not saved.

import { SvelteSet } from 'svelte/reactivity';
import type { NodeId } from '../document';

export class LayersState {
	readonly expanded = new SvelteSet<NodeId>();
	renamingId = $state.raw<NodeId | null>(null);
	/** Row that Shift+click extends the selection from. Not reactive. */
	anchorId: NodeId | null = null;
}
