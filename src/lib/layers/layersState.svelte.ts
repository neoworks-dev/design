// Reactive holder behind the `layers` service (a Service may not hold runes): which containers
// are expanded, which row is being renamed and the filter. Panel state, not document state: it
// is not undoable and not saved.

import { SvelteSet } from 'svelte/reactivity';
import type { NodeId } from '../document';
import type { ResolvedDrop } from './dropPlan';
import type { LayerTypeFilter } from './rowActions';

/** A layer drag in progress: what moves and where it would land (null when not allowed). */
export interface LayerDrag {
	ids: readonly NodeId[];
	drop: ResolvedDrop | null;
}

export class LayersState {
	readonly expanded = new SvelteSet<NodeId>();
	renamingId = $state.raw<NodeId | null>(null);
	drag = $state.raw<LayerDrag | null>(null);
	filterOpen = $state.raw(false);
	query = $state.raw('');
	types = $state.raw<readonly LayerTypeFilter[]>([]);
	/** Row that Shift+click extends the selection from. Not reactive. */
	anchorId: NodeId | null = null;
}
