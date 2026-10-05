// The `home` service: the landing view's data and actions. It shows when the window has no
// document (`document.closed`, set by the file session when the last tab closes) or when the user
// asked for it, lists recent files and drafts, and opens, creates and removes through commands
// and the `files:*` IPC domain, never by touching the document itself.

import { Service, type Context } from '@neoworks/extension-system';
import type { DraftFile, RecentFile } from '../../../electron/bridge';
import type { ContextKeysService } from '../registries/contextKeys.svelte';
import {
	entryOfDraft,
	entryOfRecent,
	visibleEntries,
	type HomeEntry,
	type HomeSection,
	type HomeSort
} from '../home/entries';
import type { HomeState, HomeView } from './homeState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		home: HomeService;
	}
}

/** The part of the `desktop` service the home screen uses (the library may not import plugins). */
export interface HomeDesktop {
	filesRecent(): Promise<RecentFile[]>;
	filesDrafts(): Promise<DraftFile[]>;
	filesRemoveRecent(path: string): Promise<void>;
	filesReveal(path: string): Promise<void>;
}

export class HomeService extends Service {
	constructor(
		ctx: Context,
		private readonly desktop: HomeDesktop,
		private readonly contextKeys: ContextKeysService,
		private readonly state: HomeState
	) {
		super(ctx, 'home');
	}

	// ---------- reads (reactive) ----------

	/** Whether the home screen covers the window. */
	get visible(): boolean {
		if (this.state.shown) return true;
		return this.contextKeys.get('document.closed') === true;
	}

	get loaded(): boolean {
		return this.state.loaded;
	}

	get section(): HomeSection {
		return this.state.section;
	}

	get view(): HomeView {
		return this.state.view;
	}

	get sort(): HomeSort {
		return this.state.sort;
	}

	get query(): string {
		return this.state.query;
	}

	/** Every entry loaded, before the section, search and sort. */
	get allEntries(): readonly HomeEntry[] {
		return this.state.entries;
	}

	/** The entries the list shows. */
	entries(): HomeEntry[] {
		return visibleEntries(this.state.entries, this.state.filter);
	}

	/** How many entries a section would list with no search text. */
	countIn(section: HomeSection): number {
		return visibleEntries(this.state.entries, { section, query: '', sort: 'recent' }).length;
	}

	// ---------- view state ----------

	setSection(section: HomeSection): void {
		this.state.section = section;
	}

	setView(view: HomeView): void {
		this.state.view = view;
	}

	setSort(sort: HomeSort): void {
		this.state.sort = sort;
	}

	setQuery(query: string): void {
		this.state.query = query;
	}

	/** Cover the window with the home screen (it hides again when a document is opened). */
	show(): void {
		this.state.shown = true;
	}

	hide(): void {
		this.state.shown = false;
	}

	// ---------- data ----------

	/** Read the recent files and drafts again. */
	async refresh(): Promise<void> {
		const [recent, drafts] = await Promise.all([
			this.desktop.filesRecent(),
			this.desktop.filesDrafts()
		]);
		this.state.entries = [...recent.map(entryOfRecent), ...drafts.map(entryOfDraft)];
		this.state.loaded = true;
	}

	// ---------- actions ----------

	/** Open an entry in a tab (or, with no tabs, as the window's document). */
	async open(entry: HomeEntry): Promise<void> {
		await this.ctx.commands.run('file.open', { path: entry.path });
		this.hide();
	}

	async newFile(): Promise<void> {
		await this.ctx.commands.run('file.new');
		this.hide();
	}

	/** The native open dialog; the home screen stays when it was cancelled. */
	async openFromDisk(): Promise<void> {
		await this.ctx.commands.run('file.open');
	}

	/** Drop a recent file from the list; the file stays on disk. */
	async removeRecent(entry: HomeEntry): Promise<void> {
		await this.desktop.filesRemoveRecent(entry.path);
		await this.refresh();
	}

	reveal(entry: HomeEntry): Promise<void> {
		return this.desktop.filesReveal(entry.path);
	}

	snapshotState(): Record<string, unknown> {
		return { shown: this.state.shown, entries: this.state.entries.length };
	}
}
