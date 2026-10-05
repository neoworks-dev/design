// Reactive holder behind the `tabs` service (a Service may not hold runes).

import type { NodeId } from '../document';
import type { SelectionSnapshot } from './selection';

/** What a tab remembers about the document while it is in the background. */
export interface TabView {
	pageId: NodeId;
	selection: SelectionSnapshot;
}

export interface Tab {
	id: string;
	/** The design file behind the tab. */
	path: string;
	name: string;
	view: TabView | null;
}

export class TabsState {
	tabs = $state.raw<Tab[]>([]);
	activeId = $state.raw<string | null>(null);
	/** Paths of recently closed saved documents, newest last, for "reopen closed tab". */
	closedPaths = $state.raw<string[]>([]);
}
