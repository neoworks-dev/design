// The `pagesPanel` service: the pages panel's model. Page edits are the document service's page
// methods (each one undo step, see docs/design/data-model.md); this adds rename and drag state.

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId, PageNode } from '../document';
import { pageDropTarget } from '../pages/pageDrop';
import type { PageDrag, PagesState } from '../pages/pagesState.svelte';
import type { DocumentService } from './document';

declare module '@neoworks/extension-system' {
	interface Context {
		pagesPanel: PagesPanelService;
	}
}

export class PagesPanelService extends Service {
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly state: PagesState
	) {
		super(ctx, 'pagesPanel');
	}

	/** Reactive. */
	pages(): PageNode[] {
		return this.document.pages();
	}

	get currentPageId(): NodeId {
		return this.document.currentPageId;
	}

	get renamingId(): NodeId | null {
		return this.state.renamingId;
	}

	get drag(): PageDrag | null {
		return this.state.drag;
	}

	switchTo(pageId: NodeId): void {
		this.document.setCurrentPage(pageId);
	}

	add(): void {
		this.document.createPage();
	}

	startRename(pageId: NodeId): void {
		if (!this.document.has(pageId)) return;
		this.state.renamingId = pageId;
	}

	stopRename(): void {
		this.state.renamingId = null;
	}

	/** An empty or unchanged name keeps the old one. */
	commitRename(name: string): void {
		const pageId = this.state.renamingId;
		this.state.renamingId = null;
		if (pageId === null) return;
		const trimmed = name.trim();
		if (trimmed.length === 0) return;
		if (this.document.require(pageId).name === trimmed) return;
		this.document.renamePage(pageId, trimmed);
	}

	// ---------- reorder by dragging ----------

	beginDrag(pageId: NodeId): void {
		const index = this.pages().findIndex((page) => page.id === pageId);
		if (index < 0) return;
		this.state.drag = { pageId, position: index, slot: index };
	}

	updateDrag(contentY: number): void {
		const drag = this.state.drag;
		if (!drag) return;
		const pages = this.pages();
		const index = pages.findIndex((page) => page.id === drag.pageId);
		const target = pageDropTarget(contentY, pages.length, index);
		this.state.drag = { pageId: drag.pageId, ...target };
	}

	cancelDrag(): void {
		this.state.drag = null;
	}

	/** Move the page: one undo step. Returns whether the order changed. */
	commitDrag(): boolean {
		const drag = this.state.drag;
		this.state.drag = null;
		if (!drag) return false;
		const index = this.pages().findIndex((page) => page.id === drag.pageId);
		if (index === drag.position) return false;
		this.document.reorderPage(drag.pageId, drag.position);
		return true;
	}

	snapshotState(): unknown {
		return { renaming: this.state.renamingId, dragging: this.state.drag !== null };
	}
}
