import type { NodeId, Rect } from '../../lib/document';
import type { Point } from '../../lib/layout/dropIndex';

/** What the overlay shows while a child is dragged inside auto layout. */
export interface ReorderFeedback {
	/** The container the drop lands in, outlined. */
	targetId: NodeId;
	/** The blue insertion line (page space); absent when the drop leaves auto layout. */
	line: { from: Point; to: Point } | null;
	/** Outlines of the dragged nodes where the pointer holds them (page space). */
	ghosts: Rect[];
}

/** The ui state of the auto layout handles: hover, the handle in use, the reorder drop. */
export class HandlesFeedback {
	/** Id of the handle under the pointer (`padding-Left`, `gap-1`). */
	hovered = $state<string | null>(null);
	/** Id and shown value of the handle being dragged. */
	dragging = $state.raw<{ id: string; value: number | undefined } | null>(null);
	reorder = $state.raw<ReorderFeedback | null>(null);
}
