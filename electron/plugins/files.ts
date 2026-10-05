// main-files: the `files` service and the `files:*` IPC routes: new, open, Save a copy as, the
// native file dialogs, the recent list and flushing the renderer before a file is closed.
//
// There are no untitled documents and no Save prompt (data-model.md section 7). A new document is
// a file in the library from its first moment and every committed transaction is autosaved, so
// leaving a document, closing a window or quitting only asks the renderer to persist its queue.

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { createBlankDocument } from '../../src/lib/document/blank';
import type { LibraryFile, LoadedDocument, StoreInfo, Thumbnail } from '../bridge';
import type { SenderHandle, WindowHandle } from '../kernel/host';
import { emitTo, route } from '../kernel/route';
import { FILE_EXTENSION, FILE_TYPE_NAME } from '../store/constants';
import { DocumentFile } from '../store/documentFile';
import { displayNameOf, realOrResolved, uniqueName, withExtension } from '../store/library';
import { FILE_THUMBNAIL_KEY } from './library';

export { FILE_THUMBNAIL_KEY };

/** How long main waits for the renderer to confirm it persisted its queue. */
export const FLUSH_TIMEOUT_MS = 2000;

export const UNTITLED_NAME = 'Untitled';

export interface FilesConfig {
	/** How long to wait for the renderer to confirm a flush (milliseconds). */
	flushTimeoutMs?: number;
	/** Files named on this launch's command line; the renderer picks the first up once. */
	launchPaths?: string[];
}

export class FilesService extends Service {
	private readonly pendingFlushes = new Map<string, () => void>();
	private readonly watchedWindows = new Set<number>();
	private readonly launchPaths: string[];
	private readonly flushTimeoutMs: number;

	constructor(ctx: Context, config: FilesConfig = {}) {
		super(ctx, 'files');
		this.launchPaths = [...(config.launchPaths ?? [])];
		this.flushTimeoutMs = config.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;
	}

	// ---------- new and open ----------

	/**
	 * A new empty document, created in `directory` (default: the library root) as `Untitled`,
	 * `Untitled 2`, ... and made the sender's document. The previous document is left alone.
	 */
	async create(sender: SenderHandle, directory?: string): Promise<LoadedDocument> {
		const library = this.ctx.library;
		const requested = directory === undefined ? library.ensureRoot() : directory;
		const target = library.resolveDirectory(requested);
		await this.flushSender(sender);
		const name = uniqueName(target.path, UNTITLED_NAME, `.${FILE_EXTENSION}`);
		const file = path.join(target.path, `${name}.${FILE_EXTENSION}`);
		const info = await this.store.adopt(sender, () =>
			DocumentFile.create(file, createBlankDocument(name))
		);
		return this.adopted(sender, info);
	}

	/** Open `target` as the sender's document; the previous document is left alone. */
	async open(sender: SenderHandle, target: string): Promise<LoadedDocument> {
		const file = this.ctx.library.openableFile(target);
		await this.flushSender(sender);
		const info = await this.store.adopt(sender, () => DocumentFile.open(file));
		return this.adopted(sender, info);
	}

	/** Copy the sender's file to `destination` and carry on editing the copy. */
	async saveAs(sender: SenderHandle, destination: string): Promise<StoreInfo> {
		const target = path.resolve(withExtension(destination));
		await this.flushSender(sender);
		const file = this.store.current(sender);
		if (realOrResolved(file.path) === realOrResolved(target)) return this.store.checkpoint(sender);
		file.saveCopyTo(target, displayNameOf(target));
		const info = await this.store.adopt(sender, () => DocumentFile.open(target));
		this.watchClose(sender);
		this.ctx.library.recordRecent(info.path, info.name);
		return info;
	}

	// ---------- native dialogs ----------

	async openDialog(): Promise<string | null> {
		const chosen = await this.ctx.electron.dialog.showOpenDialog({
			title: 'Open',
			defaultPath: this.ctx.library.dialogDirectory(),
			filters: [{ name: FILE_TYPE_NAME, extensions: [FILE_EXTENSION] }],
			multiple: false
		});
		if (chosen === null || chosen.length === 0) return null;
		return chosen[0];
	}

	async saveDialog(suggestedName: string): Promise<string | null> {
		const directory = this.ctx.library.dialogDirectory();
		const chosen = await this.ctx.electron.dialog.showSaveDialog({
			title: 'Save a copy as',
			defaultPath: path.join(directory, withExtension(suggestedName)),
			filters: [{ name: FILE_TYPE_NAME, extensions: [FILE_EXTENSION] }]
		});
		if (chosen === null) return null;
		return withExtension(chosen);
	}

	// ---------- recent files ----------

	/** Recent documents, newest first; vanished files are pruned, thumbnails read from each file. */
	recent(): LibraryFile[] {
		return this.ctx.library.recentFiles();
	}

	/** Forget one recent file; also what the home screen's "remove" does. */
	removeRecent(file: string): void {
		this.ctx.library.recents().remove(this.ctx.library.knownFile(file));
	}

	/** Show `file` in the OS file manager (library, linked and recent files only). */
	reveal(file: string): void {
		this.ctx.electron.shell.showItemInFolder(this.ctx.library.knownFile(file));
	}

	clearRecent(): void {
		this.ctx.library.recents().clear();
		this.ctx.electron.app.clearRecentDocuments();
	}

	/** Store the sender's preview. The renderer draws it (see the renderer's thumbnail seam). */
	setThumbnail(sender: SenderHandle, thumbnail: Thumbnail): void {
		this.store.current(sender).writeThumbnail(FILE_THUMBNAIL_KEY, thumbnail);
	}

	// ---------- flushing and closing ----------

	/** Ask the window's renderer to persist its queued transactions; resolves when it did or timed out. */
	requestFlush(window: WindowHandle): Promise<void> {
		if (window.isDestroyed()) return Promise.resolve();
		const requestId = randomBytes(8).toString('hex');
		return new Promise<void>((resolve) => {
			const stopTimer = this.ctx.effect(() => {
				const timer = setTimeout(() => finish(), this.flushTimeoutMs);
				return () => clearTimeout(timer);
			}, `files:flush-timeout ${requestId}`);
			const finish = (): void => {
				if (!this.pendingFlushes.delete(requestId)) return;
				void stopTimer();
				resolve();
			};
			this.pendingFlushes.set(requestId, finish);
			emitTo(window, 'files:flush-request', { requestId });
		});
	}

	/** `files:flushed`: the renderer confirmed. */
	flushed(requestId: string): void {
		this.pendingFlushes.get(requestId)?.();
	}

	/** Persist the queue of the sender's window, if it has a document. */
	async flushSender(sender: SenderHandle): Promise<void> {
		if (!this.store.hasStore(sender)) return;
		const window = this.ctx.electron.windowFromSender(sender);
		if (window !== null) await this.requestFlush(window);
	}

	/** `app/before-quit`: persist every window's queue. */
	async prepareToQuit(): Promise<void> {
		const withDocuments = this.ctx.electron
			.windows()
			.filter((window) => this.store.hasStore(window.sender));
		await Promise.all(withDocuments.map((window) => this.requestFlush(window)));
	}

	/** A window was asked to close: persist its queue and let it. Closing never prompts. */
	async onClose(window: WindowHandle): Promise<boolean> {
		if (this.store.hasStore(window.sender)) await this.requestFlush(window);
		return true;
	}

	// ---------- opening on the OS's request ----------

	/** The file this launch was asked to open, once. */
	takeLaunchRequest(): string | null {
		return this.launchPaths.shift() ?? null;
	}

	/** The path of the file `sender` has open, or `null`. */
	openFileOf(sender: SenderHandle): string | null {
		if (!this.store.hasStore(sender)) return null;
		return this.store.current(sender).path;
	}

	/** Have the next window that asks for its launch file open `target` (a reloaded window). */
	queueLaunch(target: string): void {
		this.launchPaths.unshift(target);
	}

	/** The OS asked the running app to open `target`: tell the window, or keep it for launch. */
	requestOpen(target: string): void {
		const windows = this.ctx.electron.windows();
		if (windows.length === 0) {
			this.launchPaths.push(target);
			return;
		}
		for (const window of windows) emitTo(window, 'files:open-request', { path: target });
	}

	snapshotState(): Record<string, unknown> {
		return { pendingFlushes: this.pendingFlushes.size, launchPaths: [...this.launchPaths] };
	}

	// ---------- internals ----------

	/** From now on the sender's window flushes through this service before it closes. */
	private watchClose(sender: SenderHandle): void {
		if (this.watchedWindows.has(sender.id)) return;
		const window = this.ctx.electron.windowFromSender(sender);
		if (window === null) return;
		this.watchedWindows.add(sender.id);
		const release = this.ctx.effect(() => {
			const stopAsking = window.onCloseRequest(() => this.onClose(window));
			const stopWatching = window.on('closed', () => void release());
			return () => {
				stopAsking();
				stopWatching();
				this.watchedWindows.delete(sender.id);
			};
		}, `files:close-request ${sender.id}`);
	}

	private get store(): Context['store'] {
		return this.ctx.store;
	}

	private adopted(sender: SenderHandle, info: StoreInfo): LoadedDocument {
		this.watchClose(sender);
		this.ctx.library.recordRecent(info.path, info.name);
		return { info, document: this.store.current(sender).load() };
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		files: FilesService;
	}
}

export const mainFilesPlugin: Plugin.Object<FilesConfig> = {
	name: 'main-files',
	inject: ['electron', 'ipc', 'store', 'library'],
	apply(ctx, config) {
		const files = new FilesService(ctx, config);

		route(ctx, 'files:new', (request, event) => files.create(event.sender, request.directory));
		route(ctx, 'files:open', (request, event) => files.open(event.sender, request.path));
		route(ctx, 'files:openDialog', () => files.openDialog());
		route(ctx, 'files:saveDialog', (request) => files.saveDialog(request.suggestedName));
		route(ctx, 'files:saveAs', (request, event) => files.saveAs(event.sender, request.path));
		route(ctx, 'files:recent', () => files.recent());
		route(ctx, 'files:removeRecent', (request) => files.removeRecent(request.path));
		route(ctx, 'files:reveal', (request) => files.reveal(request.path));
		route(ctx, 'files:clearRecent', () => files.clearRecent());
		route(ctx, 'files:setThumbnail', (thumbnail, event) =>
			files.setThumbnail(event.sender, thumbnail)
		);
		route(ctx, 'files:launchRequest', () => files.takeLaunchRequest());
		route(ctx, 'files:flushed', (request) => files.flushed(request.requestId));

		ctx.on('app/before-quit', () => files.prepareToQuit());

		ctx.effect(() => {
			const openFile = (target: string): void => files.requestOpen(target);
			ctx.electron.app.on('open-file', openFile);
			return () => ctx.electron.app.off('open-file', openFile);
		}, 'main-files:open-file');
		ctx.effect(() => {
			const secondLaunch = (argv: string[]): void => {
				const named = argv.find((argument) => argument.endsWith(`.${FILE_EXTENSION}`));
				if (named !== undefined) files.requestOpen(named);
			};
			ctx.electron.app.on('second-instance', secondLaunch);
			return () => ctx.electron.app.off('second-instance', secondLaunch);
		}, 'main-files:second-instance');
	}
};
