// Reactive holder behind the `prototype` service (a Service may not hold runes).

import type { NodeId } from '../document/types';

export interface InteractionRef {
	nodeId: NodeId;
	index: number;
}

/** A connection being dragged from a node's handle: where it points and what it would hit. */
export interface ConnectionDrag {
	sourceId: NodeId;
	/** Page position of the pointer. */
	world: { x: number; y: number };
	targetId: NodeId | null;
}

export class PrototypeState {
	/** The interaction open in the panel. */
	activeInteraction = $state.raw<InteractionRef | null>(null);
	/** The connection arrow selected on the canvas (Delete removes it). */
	selectedConnection = $state.raw<InteractionRef | null>(null);
	drag = $state.raw<ConnectionDrag | null>(null);
}
