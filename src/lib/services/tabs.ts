// The `tabs` service: several documents in one window.
//
// Decision (#138): one live document per window, switched on demand, rather than one kernel
// sub-context per document through `ctx.isolate`. Every plugin reads `ctx.document`, `ctx.history`,
// `ctx.selection` and `ctx.viewport` as singletons of the window, and a second set of them would
// need every one of those plugins mounted twice. Switching keeps plugins unaware of tabs: the
// session's `openInTab` makes another file the window's document (main closes the previous
// store handle, so only one file is ever open), the autosave queue guarantees the one left is
// persisted, and a background tab is just its file. A tab remembers its page and selection; undo
// history is per live document, so it starts empty when a tab is switched back to.
//
// The tab list follows the session: `file/attached` creates the first tab and relabels the active
// one after Save As; File > New / Open reach the service through the `file/open-request` event.

import { Service, type Context } from '@neoworks/extension-system';
import type { StoreInfo } from '../../../electron/bridge';
import type { FileOpenRequest } from '../kernel/events';
import type { DocumentService } from './document';
import type { FileSessionService } from './fileSession';
import type { SelectionService } from './selection';
import type { Tab, TabsState } from './tabsState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		tabs: TabsService;
	}
}

const CLOSED_HISTORY_LIMIT = 10;

export class TabsService extends Service {
	private switching = false;
	private lastOperation: Promise<unknown> = Promise.resolve();
	private nextId = 1;

	constructor(
		ctx: Context,
		private readonly session: FileSessionService,
		private readonly document: DocumentService,
		private readonly selection: SelectionService,
		private readonly state: TabsState
	) {
		super(ctx, 'tabs');
	}

	// ---------- reads (reactive) ----------

	get tabs(): readonly Tab[] {
		return this.state.tabs;
	}

	get activeId(): string | null {
		return this.state.activeId;
	}

	get activeTab(): Tab | undefined {
		return this.state.tabs.find((tab) => tab.id === this.state.activeId);
	}

	/** Whether the tab has edits since its last Save (live for the active tab). */
	isDirty(tab: Tab): boolean {
		if (tab.id === this.state.activeId) return this.session.dirty;
		return tab.dirty;
	}

	/** The name to show: the live one for the active tab (it changes with Save As). */
	nameOf(tab: Tab): string {
		if (tab.id === this.state.activeId) return this.session.displayName;
		return tab.name;
	}

	get canReopenClosed(): boolean {
		return this.state.closedPaths.length > 0;
	}

	// ---------- following the session ----------

	/** `file/attached`: the first document makes the first tab, Save As relabels the active one. */
	handleAttached(info: StoreInfo): void {
		if (this.switching) return;
		const active = this.activeTab;
		if (active === undefined) {
			this.addAndActivate(info);
			return;
		}
		this.replaceTab({ ...active, path: info.path, name: info.name, untitled: info.untitled });
	}

	/** `file/open-request`: open in a tab, unless there are no tabs yet (the session starts it). */
	async handleOpenRequest(request: FileOpenRequest): Promise<boolean | undefined> {
		if (this.state.tabs.length === 0) return undefined;
		if (request.kind === 'new') await this.newTab();
		else await this.openPath(request.path);
		return true;
	}

	// ---------- operations (one at a time, in call order) ----------

	newTab(): Promise<void> {
		return this.enqueue(async () => {
			this.leaveActive();
			await this.whileSwitching(() => this.session.newInTab());
			this.addFromSession();
		});
	}

	/** Open a design file in a tab; a file that is already a tab is just activated. */
	openPath(path: string): Promise<void> {
		return this.enqueue(async () => {
			const existing = this.state.tabs.find((tab) => tab.path === path);
			if (existing !== undefined) {
				await this.activateNow(existing.id);
				return;
			}
			this.leaveActive();
			await this.whileSwitching(() => this.session.openInTab(path));
			this.addFromSession();
		});
	}

	activate(id: string): Promise<void> {
		return this.enqueue(() => this.activateNow(id));
	}

	/** Close a tab. An untitled document with edits asks first; the last tab leaves the home screen. */
	close(id: string): Promise<void> {
		return this.enqueue(async () => {
			const tab = this.state.tabs.find((candidate) => candidate.id === id);
			if (tab === undefined) return;
			if (id !== this.state.activeId && !tab.untitled) {
				this.removeTab(id);
				this.rememberClosed(tab);
				return;
			}
			await this.activateNow(id);
			await this.closeActiveNow();
		});
	}

	closeActive(): Promise<void> {
		return this.enqueue(() => this.closeActiveNow());
	}

	/** Activate the next (`1`) or previous (`-1`) tab, wrapping around. */
	cycle(direction: 1 | -1): Promise<void> {
		return this.enqueue(async () => {
			const tabs = this.state.tabs;
			if (tabs.length < 2) return;
			const current = tabs.findIndex((tab) => tab.id === this.state.activeId);
			const next = (current + direction + tabs.length) % tabs.length;
			await this.activateNow(tabs[next].id);
		});
	}

	/** Reorder: put the tab at `index` (counted before it is taken out). */
	move(id: string, index: number): void {
		const tabs = [...this.state.tabs];
		const from = tabs.findIndex((tab) => tab.id === id);
		if (from < 0) return;
		const [tab] = tabs.splice(from, 1);
		const target = Math.max(0, Math.min(tabs.length, index > from ? index - 1 : index));
		tabs.splice(target, 0, tab);
		this.state.tabs = tabs;
	}

	/** Reopen the most recently closed saved document in a tab. */
	reopenClosed(): Promise<void> {
		const closed = this.state.closedPaths;
		if (closed.length === 0) return Promise.resolve();
		const path = closed[closed.length - 1];
		this.state.closedPaths = closed.slice(0, -1);
		return this.openPath(path);
	}

	snapshotState(): Record<string, unknown> {
		return { tabs: this.state.tabs.length, active: this.state.activeId };
	}

	// ---------- internals ----------

	/** Run `operation` after the previous one finished; a failure does not block the queue. */
	private enqueue(operation: () => Promise<void>): Promise<void> {
		const run = this.lastOperation.then(operation, operation);
		this.lastOperation = run.catch(() => undefined);
		return run;
	}

	private async whileSwitching(operation: () => Promise<void>): Promise<void> {
		this.switching = true;
		try {
			await operation();
		} finally {
			this.switching = false;
		}
	}

	private async activateNow(id: string): Promise<void> {
		const target = this.state.tabs.find((tab) => tab.id === id);
		if (target === undefined || id === this.state.activeId) return;
		this.leaveActive();
		try {
			await this.whileSwitching(() => this.session.openInTab(target.path));
		} catch (error) {
			// The file is gone or unreadable: its tab cannot be shown, and the window kept the
			// document it had.
			this.removeTab(id);
			throw error;
		}
		this.state.activeId = id;
		this.restoreView(target);
	}

	private async closeActiveNow(): Promise<void> {
		const tab = this.activeTab;
		if (tab === undefined) return;
		if (!(await this.session.confirmClose())) return;
		const neighbour = this.neighbourOf(tab.id);
		this.removeTab(tab.id);
		if (neighbour === undefined) {
			await this.session.closeDocument(this.discardPathOf(tab));
			this.state.activeId = null;
		} else {
			await this.whileSwitching(() => this.session.openInTab(neighbour.path));
			this.state.activeId = neighbour.id;
			this.restoreView(neighbour);
			const discardPath = this.discardPathOf(tab);
			if (discardPath !== undefined) await this.session.discard(discardPath);
		}
		this.rememberClosed(tab);
	}

	/** The temporary file to delete once an untitled tab is closed; saved files are never deleted. */
	private discardPathOf(tab: Tab): string | undefined {
		if (tab.untitled) return tab.path;
		return undefined;
	}

	private neighbourOf(id: string): Tab | undefined {
		const tabs = this.state.tabs;
		const index = tabs.findIndex((tab) => tab.id === id);
		if (index < 0) return undefined;
		if (index + 1 < tabs.length) return tabs[index + 1];
		if (index > 0) return tabs[index - 1];
		return undefined;
	}

	/** Remember what the active tab looks like before another document replaces it. */
	private leaveActive(): void {
		const active = this.activeTab;
		if (active === undefined) return;
		this.replaceTab({
			...active,
			name: this.session.displayName,
			dirty: this.session.dirty,
			view: { pageId: this.document.currentPageId, selection: this.selection.snapshot() }
		});
	}

	private restoreView(tab: Tab): void {
		const view = tab.view;
		if (view === null) return;
		if (!this.document.has(view.pageId)) return;
		this.document.setCurrentPage(view.pageId);
		this.selection.restore(view.selection);
	}

	private addFromSession(): void {
		const info = this.session.info;
		if (info === null) return;
		this.addAndActivate(info);
	}

	private addAndActivate(info: StoreInfo): void {
		const tab: Tab = {
			id: `tab-${this.nextId}`,
			path: info.path,
			name: info.name,
			untitled: info.untitled,
			dirty: false,
			view: null
		};
		this.nextId += 1;
		this.state.tabs = [...this.state.tabs, tab];
		this.state.activeId = tab.id;
	}

	private replaceTab(next: Tab): void {
		this.state.tabs = this.state.tabs.map((tab) => {
			if (tab.id === next.id) return next;
			return tab;
		});
	}

	private removeTab(id: string): void {
		this.state.tabs = this.state.tabs.filter((tab) => tab.id !== id);
	}

	private rememberClosed(tab: Tab): void {
		if (tab.untitled) return;
		const kept = this.state.closedPaths.filter((path) => path !== tab.path);
		this.state.closedPaths = [...kept, tab.path].slice(-CLOSED_HISTORY_LIMIT);
	}
}
