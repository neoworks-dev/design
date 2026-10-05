// Reactive holder behind the `pagesPanel` service (a Service may not hold runes).

import type { NodeId } from '../document';

export interface PageDrag {
	pageId: NodeId;
	/** Index among the pages the dragged page would take (the others keep their order). */
	position: number;
	/** The insertion line sits above the row with this index (0 to page count). */
	slot: number;
}

export class PagesState {
	renamingId = $state.raw<NodeId | null>(null);
	drag = $state.raw<PageDrag | null>(null);
}
