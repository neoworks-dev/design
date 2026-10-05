// The `home` service: the landing view's data and actions (Draftboard's overview, like Figma's
// file browser). It shows when the window has no document (`document.closed`, set by the file
// session when the last tab closes, and at launch) or when the user asked for it. It lists the
// recent files, the library's Drafts and folders, and linked folders; searches; and opens,
// creates, renames, moves, duplicates and trashes through the `library:*` and `files:*` IPC
// domains and the file commands, never by touching the document itself.
//
// Every action reports a failure through `options.report` (a toast) and leaves the screen as it
// was; none of them rejects.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	DirectoryListing,
	LibraryFile,
	LibraryFolder,
	LibraryOverview,
	LinkedFolder
} from '../../../electron/bridge';
import {
	breadcrumbsOf,
	directoryOf,
	isLibraryDirectory,
	sortFiles,
	sortFolders,
	type Breadcrumb,
	type HomeLocation,
	type HomeSort
} from '../home/library';
import type { ContextKeysService } from '../registries/contextKeys.svelte';
import type { HomeState, HomeView, PendingTrash } from './homeState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		home: HomeService;
	}
}

/** The part of the `desktop` service the home screen uses (the library may not import plugins). */
export interface HomeDesktop {
	filesRecent(): Promise<LibraryFile[]>;
	filesRemoveRecent(path: string): Promise<void>;
	filesReveal(path: string): Promise<void>;
	libraryOverview(): Promise<LibraryOverview>;
	libraryList(directory: string): Promise<DirectoryListing>;
	librarySearch(query: string): Promise<LibraryFile[]>;
	libraryCreateFolder(parent: string, name: string): Promise<LibraryFolder>;
	libraryRenameFolder(path: string, name: string): Promise<LibraryFolder>;
	libraryTrashFolder(path: string): Promise<void>;
	libraryRenameFile(path: string, name: string): Promise<LibraryFile>;
	libraryMoveFile(path: string, directory: string): Promise<LibraryFile>;
	libraryDuplicateFile(path: string): Promise<LibraryFile>;
	libraryTrashFile(path: string): Promise<void>;
	libraryLinkFolder(): Promise<LinkedFolder | null>;
	libraryUnlinkFolder(id: string): Promise<void>;
}

export interface HomeOptions {
	/** Shows a failure to the user. */
	report: (message: string) => void;
	/** The overview changed (new folders, links): the "Move to" menu is rebuilt from it. */
	onOverview?: (overview: LibraryOverview) => void;
}

export const FILE_MENU = 'home-file';
export const FOLDER_MENU = 'home-folder';
export const LINKED_MENU = 'home-linked';

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class HomeService extends Service {
	private searchToken = 0;

	constructor(
		ctx: Context,
		private readonly desktop: HomeDesktop,
		private readonly contextKeys: ContextKeysService,
		private readonly state: HomeState,
		private readonly options: HomeOptions
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

	get overview(): LibraryOverview | null {
		return this.state.overview;
	}

	get location(): HomeLocation {
		return this.state.location;
	}

	get inRecents(): boolean {
		return this.state.location.kind === 'recents';
	}

	/** The directory the home screen shows while it is visible; where New file creates. */
	get currentDirectory(): string | undefined {
		if (!this.visible) return undefined;
		const location = this.state.location;
		if (location.kind === 'recents') return undefined;
		return location.path;
	}

	/** Header trail of the shown directory; empty for Recents. */
	get breadcrumbs(): Breadcrumb[] {
		const location = this.state.location;
		const overview = this.state.overview;
		if (location.kind === 'recents' || overview === null) return [];
		return breadcrumbsOf(overview, location.path);
	}

	/** Whether the shown directory is a linked folder or inside one (it lists subfolders). */
	get inLinkedFolder(): boolean {
		const location = this.state.location;
		const overview = this.state.overview;
		if (location.kind === 'recents' || overview === null) return false;
		return !isLibraryDirectory(overview, location.path);
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

	get searching(): boolean {
		return this.state.query.trim() !== '';
	}

	get creatingFolder(): boolean {
		return this.state.creatingFolder;
	}

	get renamingPath(): string | null {
		return this.state.renamingPath;
	}

	get pendingTrash(): PendingTrash | null {
		return this.state.pendingTrash;
	}

	/** The files the main area lists: the search results, else the location's files, sorted. */
	files(): LibraryFile[] {
		const results = this.state.results;
		if (this.searching && results !== null) return sortFiles(results, this.state.sort);
		return sortFiles(this.state.files, this.state.sort);
	}

	/** The subdirectory cards (linked folders only), by name; none while searching. */
	folders(): LibraryFolder[] {
		if (this.searching) return [];
		if (!this.inLinkedFolder) return [];
		return sortFolders(this.state.folders);
	}

	// ---------- view state ----------

	setView(view: HomeView): void {
		this.state.view = view;
	}

	setSort(sort: HomeSort): void {
		this.state.sort = sort;
	}

	/** Cover the window with the home screen (it hides again when a document is opened). */
	show(): void {
		this.state.shown = true;
	}

	hide(): void {
		this.state.shown = false;
	}

	// ---------- data ----------

	/** Read the sidebar, the shown location and the search again. */
	refresh(): Promise<void> {
		return this.attempt('load the library', () => this.loadAll());
	}

	showRecents(): Promise<void> {
		this.state.location = { kind: 'recents' };
		return this.attempt('load recent files', () => this.loadLocation());
	}

	showDirectory(path: string): Promise<void> {
		this.state.location = { kind: 'directory', path };
		return this.attempt('open the folder', () => this.loadLocation());
	}

	/** Search the library and linked folders by file name; an empty query shows the location. */
	setQuery(query: string): Promise<void> {
		this.state.query = query;
		return this.attempt('search', () => this.loadSearch());
	}

	// ---------- file actions ----------

	/** Open a file in a tab (or, with no tabs, as the window's document). */
	open(file: LibraryFile): Promise<void> {
		return this.attempt('open the file', async () => {
			await this.ctx.commands.run('file.open', { path: file.path });
			this.hide();
		});
	}

	/** Create a design file in the shown directory (the library root from Recents). */
	newFile(): Promise<void> {
		return this.attempt('create the file', async () => {
			await this.ctx.commands.run('file.new', { directory: this.currentDirectory });
			this.hide();
		});
	}

	/** The native open dialog; the home screen stays when it was cancelled. */
	openFromDisk(): Promise<void> {
		return this.attempt('open the file', () => this.ctx.commands.run('file.open'));
	}

	beginRename(path: string): void {
		this.state.renamingPath = path;
	}

	cancelRename(): void {
		this.state.renamingPath = null;
	}

	renameFile(file: LibraryFile, name: string): Promise<void> {
		this.state.renamingPath = null;
		const trimmed = name.trim();
		if (trimmed === '' || trimmed === file.name) return Promise.resolve();
		return this.attempt('rename the file', async () => {
			await this.desktop.libraryRenameFile(file.path, trimmed);
			await this.loadAll();
		});
	}

	duplicateFile(file: LibraryFile): Promise<void> {
		return this.attempt('duplicate the file', async () => {
			await this.desktop.libraryDuplicateFile(file.path);
			await this.loadAll();
		});
	}

	/** Move a file into `directory`; dropping it where it already is does nothing. */
	moveFile(path: string, directory: string): Promise<void> {
		if (directoryOf(path) === directory) return Promise.resolve();
		return this.attempt('move the file', async () => {
			await this.desktop.libraryMoveFile(path, directory);
			await this.loadAll();
		});
	}

	/** The "Move to" menu item: move the file the menu was opened for. */
	moveMenuFileTo(directory: string): Promise<void> {
		const path = this.state.menuFilePath;
		if (path === null) return Promise.resolve();
		return this.moveFile(path, directory);
	}

	/** Drop a recent file from the list; the file stays on disk. */
	removeRecent(file: LibraryFile): Promise<void> {
		return this.attempt('remove the file from recents', async () => {
			await this.desktop.filesRemoveRecent(file.path);
			await this.loadAll();
		});
	}

	reveal(path: string): Promise<void> {
		return this.attempt('show it in the file manager', () => this.desktop.filesReveal(path));
	}

	/** The file under a path in what is listed now. */
	findFile(path: string): LibraryFile | undefined {
		const candidates = [...this.state.files, ...(this.state.results ?? [])];
		return candidates.find((file) => file.path === path);
	}

	findFolder(path: string): LibraryFolder | undefined {
		const overview = this.state.overview;
		const candidates = [...this.state.folders];
		if (overview !== null) candidates.push(...overview.folders);
		return candidates.find((folder) => folder.path === path);
	}

	// ---------- trash (asks first) ----------

	requestTrashFile(file: LibraryFile): void {
		this.state.pendingTrash = { kind: 'file', path: file.path, name: file.name };
	}

	requestTrashFolder(folder: LibraryFolder): void {
		this.state.pendingTrash = { kind: 'folder', path: folder.path, name: folder.name };
	}

	cancelTrash(): void {
		this.state.pendingTrash = null;
	}

	confirmTrash(): Promise<void> {
		const pending = this.state.pendingTrash;
		this.state.pendingTrash = null;
		if (pending === null) return Promise.resolve();
		return this.attempt('move it to the trash', async () => {
			if (pending.kind === 'file') await this.desktop.libraryTrashFile(pending.path);
			else await this.trashFolderNow(pending.path);
			await this.loadAll();
		});
	}

	// ---------- folders ----------

	beginCreateFolder(): void {
		this.state.creatingFolder = true;
	}

	cancelCreateFolder(): void {
		this.state.creatingFolder = false;
	}

	/** Make a library folder (one level, under the library root). */
	createFolder(name: string): Promise<void> {
		this.state.creatingFolder = false;
		const trimmed = name.trim();
		const overview = this.state.overview;
		if (trimmed === '' || overview === null) return Promise.resolve();
		return this.attempt('create the folder', async () => {
			await this.desktop.libraryCreateFolder(overview.root, trimmed);
			await this.loadAll();
		});
	}

	renameFolder(folder: LibraryFolder, name: string): Promise<void> {
		this.state.renamingPath = null;
		const trimmed = name.trim();
		if (trimmed === '' || trimmed === folder.name) return Promise.resolve();
		return this.attempt('rename the folder', async () => {
			const renamed = await this.desktop.libraryRenameFolder(folder.path, trimmed);
			const location = this.state.location;
			if (location.kind === 'directory' && location.path === folder.path) {
				this.state.location = { kind: 'directory', path: renamed.path };
			}
			await this.loadAll();
		});
	}

	/** Pick a directory and add it to the sidebar as a linked folder, then show it. */
	linkFolder(): Promise<void> {
		return this.attempt('link the folder', async () => {
			const linked = await this.desktop.libraryLinkFolder();
			if (linked === null) return;
			this.state.location = { kind: 'directory', path: linked.path };
			await this.loadAll();
		});
	}

	unlinkFolder(linked: LinkedFolder): Promise<void> {
		return this.attempt('unlink the folder', async () => {
			await this.desktop.libraryUnlinkFolder(linked.id);
			if (this.isInsideDirectory(linked.path)) this.state.location = { kind: 'recents' };
			await this.loadAll();
		});
	}

	// ---------- context menus ----------

	openFileMenu(event: MouseEvent, file: LibraryFile): void {
		this.state.menuFilePath = file.path;
		this.ctx.menus.openFromEvent(FILE_MENU, event, { path: file.path });
	}

	openFolderMenu(event: MouseEvent, folder: LibraryFolder): void {
		this.ctx.menus.openFromEvent(FOLDER_MENU, event, { path: folder.path });
	}

	openLinkedMenu(event: MouseEvent, linked: LinkedFolder): void {
		this.ctx.menus.openFromEvent(LINKED_MENU, event, { id: linked.id, path: linked.path });
	}

	// ---------- following the file system ----------

	/** `file/moved`: a file was renamed, moved or trashed; what is listed may be stale. */
	handleMoved(): Promise<void> {
		if (!this.state.loaded) return Promise.resolve();
		return this.refresh();
	}

	snapshotState(): Record<string, unknown> {
		return { shown: this.state.shown, files: this.state.files.length };
	}

	// ---------- internals ----------

	/** Run `run`; a failure becomes a toast, never a rejection. */
	private async attempt(action: string, run: () => Promise<unknown>): Promise<void> {
		try {
			await run();
		} catch (error) {
			this.options.report(`Could not ${action}: ${describe(error)}`);
		}
	}

	private async loadAll(): Promise<void> {
		const overview = await this.desktop.libraryOverview();
		this.state.overview = overview;
		this.state.loaded = true;
		this.options.onOverview?.(overview);
		await this.loadLocation();
	}

	private async loadLocation(): Promise<void> {
		const location = this.state.location;
		if (location.kind === 'recents') {
			this.state.files = await this.desktop.filesRecent();
			this.state.folders = [];
		} else {
			await this.loadDirectory(location.path);
		}
		await this.loadSearch();
	}

	/** List `path`; a directory that vanished (trashed, unplugged) falls back to the library root. */
	private async loadDirectory(path: string): Promise<void> {
		let listing: DirectoryListing;
		try {
			listing = await this.desktop.libraryList(path);
		} catch (error) {
			const overview = this.state.overview;
			if (overview === null || overview.root === path) throw error;
			this.state.location = { kind: 'directory', path: overview.root };
			listing = await this.desktop.libraryList(overview.root);
		}
		this.state.files = listing.files;
		this.state.folders = listing.folders;
	}

	private async loadSearch(): Promise<void> {
		this.searchToken += 1;
		const token = this.searchToken;
		const needle = this.state.query.trim();
		if (needle === '') {
			this.state.results = null;
			return;
		}
		const results = await this.desktop.librarySearch(needle);
		if (token === this.searchToken) this.state.results = results;
	}

	private async trashFolderNow(path: string): Promise<void> {
		await this.desktop.libraryTrashFolder(path);
		if (this.isInsideDirectory(path)) this.state.location = { kind: 'recents' };
	}

	private isInsideDirectory(directory: string): boolean {
		const location = this.state.location;
		if (location.kind === 'recents') return false;
		if (location.path === directory) return true;
		return location.path.startsWith(`${directory}/`) || location.path.startsWith(`${directory}\\`);
	}
}
