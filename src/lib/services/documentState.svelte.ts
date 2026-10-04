// Reactive holder behind the `document` service. A `Service` may not hold runes, so the live
// store, the revision counter and the current page live here and the service delegates to it.
//
// Reads in components and `$derived`s depend on `revision`: every commit bumps it, so anything
// that read the document re-runs. Node objects are immutable (a `set` swaps in a copy), so
// re-running is cheap and unchanged nodes keep their identity.

import { SvelteMap } from 'svelte/reactivity';
import {
	createBlankDocument,
	DocumentStore,
	type ApplyMeta,
	type Change,
	type DesignDocument,
	type NodeId
} from '../document';

/** The open batch of `document.transaction()`; changes are applied as they come, committed once. */
export interface Batch {
	id: string;
	meta: ApplyMeta;
	applied: Change[];
	/** Parallel to `applied`: the change was appended by a `document/append` listener. */
	derived: boolean[];
}

export interface PageViewport {
	x: number;
	y: number;
	zoom: number;
}

export const DEFAULT_PAGE_VIEWPORT: PageViewport = { x: 0, y: 0, zoom: 1 };

export class DocumentState {
	store = $state.raw<DocumentStore>(new DocumentStore(createBlankDocument()));
	revision = $state.raw(0);
	currentPageId = $state.raw<NodeId | null>(null);

	/** Not reactive: only `document.apply` reads and writes it. */
	batch: Batch | null = null;
	readonly viewports = new SvelteMap<NodeId, PageViewport>();

	/** Subscribe the running `$derived` / `$effect` to every document change. */
	track(): void {
		void this.revision;
		void this.store;
	}

	replace(document: DesignDocument): void {
		this.store = new DocumentStore(document);
		this.viewports.clear();
		this.revision += 1;
	}
}
