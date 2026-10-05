// main-files: the `files` service and the `files:*` IPC routes: new, open, Save As, the native
// file dialogs, untitled documents and their recovery, and flushing the renderer before a file
// is closed.
//
// Untitled documents are SQLite files in `<userData>/untitled/` (data-model.md section 7) until
// the user saves them somewhere with Save As. Autosave means nothing is ever "unsaved in memory":
// leaving an untitled document with edits asks first (Save / Don't Save / Cancel); a saved
// document never asks. Anything left in the untitled directory at the next start (a crash, or a
// quit with an untitled document open) is offered for recovery.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { createBlankDocument } from '../../src/lib/document/blank';
import type { LoadedDocument, RecentFile, StoreInfo, Thumbnail } from '../bridge';
import type { SenderHandle, WindowHandle } from '../kernel/host';
import { emitTo, route } from '../kernel/route';
import { FILE_EXTENSION, FILE_TYPE_NAME } from '../store/constants';
import { DocumentFile, removeFileAndSidecars } from '../store/documentFile';
import { StoreError } from '../store/errors';
import { RECENT_FILES_NAME, RecentFilesStore } from '../store/recentFiles';
import { untitledDirectory } from '../store/untitled';

/** How long main waits for the renderer to confirm it persisted its queue. */
export const FLUSH_TIMEOUT_MS = 2000;

export const UNTITLED_NAME = 'Untitled';

/** The `thumbnails` key of a document's own preview. */
export const FILE_THUMBNAIL_KEY = 'file';

export interface FilesConfig {
	/** How long to wait for the renderer to confirm a flush (milliseconds). */
	flushTimeoutMs?: number;
	/** Files named on this launch's command line; the renderer picks the first up once. */
	launchPaths?: string[];
}

/** An untitled document with edits that an earlier run left behind. */
export interface RecoverableDocument {
	path: string;
	name: string;
	modifiedAt: number;
}

type Decision = 'proceed' | 'cancel';

const SAVE_CHOICE = 0;
const DISCARD_CHOICE = 1;

function withExtension(file: string): string {
	if (path.extname(file) === `.${FILE_EXTENSION}`) return file;
	return `${file}.${FILE_EXTENSION}`;
}

function displayNameOf(file: string): string {
	return path.basename(file, path.extname(file));
}

export class FilesService extends Service {
	private readonly pendingFlushes = new Map<string, () => void>();
	private readonly watchedWindows = new Set<number>();
	private readonly launchPaths: string[];
	private readonly flushTimeoutMs: number;
	private quitting = false;
	private recentStore: RecentFilesStore | null = null;

	constructor(ctx: Context, config: FilesConfig = {}) {
		super(ctx, 'files');
		this.launchPaths = [...(config.launchPaths ?? [])];
		this.flushTimeoutMs = config.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;
	}

	// ---------- new and open ----------

	/** A new empty document in a temporary file; `null` when the user cancelled leaving the old one. */
	async newUntitled(sender: SenderHandle): Promise<LoadedDocument | null> {
		const previous = this.currentFile(sender);
		if ((await this.settleCurrent(sender)) === 'cancel') return null;
		const target = this.nextUntitledPath();
		const info = await this.store.adopt(sender, () =>
			DocumentFile.create(target, createBlankDocument(UNTITLED_NAME))
		);
		this.discardIfUntitled(previous);
		this.watchClose(sender);
		this.recordRecent(info);
		return this.loaded(sender, info);
	}

	/** Open `target` as the sender's document; `null` when the user cancelled leaving the old one. */
	async open(sender: SenderHandle, target: string): Promise<LoadedDocument | null> {
		const previous = this.currentFile(sender);
		if ((await this.settleCurrent(sender)) === 'cancel') return null;
		const info = await this.store.adopt(sender, () => DocumentFile.open(target));
		if (previous !== null && previous !== path.resolve(target)) this.discardIfUntitled(previous);
		this.watchClose(sender);
		this.recordRecent(info);
		return this.loaded(sender, info);
	}

	/**
	 * Tabs: `target` becomes the sender's document and the one it had is left alone, to be a tab in
	 * the background. The renderer persisted that document's queue first; main confirms it again.
	 */
	async openInTab(sender: SenderHandle, target: string): Promise<LoadedDocument> {
		await this.flushSender(sender);
		const info = await this.store.adopt(sender, () => DocumentFile.open(target));
		this.watchClose(sender);
		this.recordRecent(info);
		return this.loaded(sender, info);
	}

	/** Tabs: like `newUntitled`, without asking about or deleting the previous document. */
	async newInTab(sender: SenderHandle): Promise<LoadedDocument> {
		await this.flushSender(sender);
		const target = this.nextUntitledPath();
		const info = await this.store.adopt(sender, () =>
			DocumentFile.create(target, createBlankDocument(UNTITLED_NAME))
		);
		this.watchClose(sender);
		return this.loaded(sender, info);
	}

	/** Tabs: whether the sender's document may be closed (asks about untitled edits). */
	async confirmClose(sender: SenderHandle): Promise<boolean> {
		return (await this.settleCurrent(sender)) === 'proceed';
	}

	/** Tabs: delete the temporary file of a closed untitled document, unless something has it open. */
	discard(file: string): void {
		const resolved = path.resolve(file);
		if (this.store.openPaths().some((open) => path.resolve(open) === resolved)) return;
		this.discardIfUntitled(resolved);
	}

	/** Copy the sender's file to `destination` and carry on editing the copy. */
	async saveAs(sender: SenderHandle, destination: string): Promise<StoreInfo> {
		const target = path.resolve(withExtension(destination));
		const file = this.store.current(sender);
		if (path.resolve(file.path) === target) return this.store.checkpoint(sender);
		const source = file.path;
		file.saveCopyTo(target, displayNameOf(target));
		const info = await this.store.adopt(sender, () => DocumentFile.open(target));
		this.discardIfUntitled(source);
		this.recordRecent(info);
		return info;
	}

	// ---------- native dialogs ----------

	async openDialog(): Promise<string | null> {
		const chosen = await this.ctx.electron.dialog.showOpenDialog({
			title: 'Open',
			defaultPath: this.ctx.electron.app.getPath('documents'),
			filters: [{ name: FILE_TYPE_NAME, extensions: [FILE_EXTENSION] }],
			multiple: false
		});
		if (chosen === null || chosen.length === 0) return null;
		return chosen[0];
	}

	async saveDialog(suggestedName: string): Promise<string | null> {
		const documents = this.ctx.electron.app.getPath('documents');
		const chosen = await this.ctx.electron.dialog.showSaveDialog({
			title: 'Save As',
			defaultPath: path.join(documents, withExtension(suggestedName)),
			filters: [{ name: FILE_TYPE_NAME, extensions: [FILE_EXTENSION] }]
		});
		if (chosen === null) return null;
		return withExtension(chosen);
	}

	// ---------- recent files ----------

	/** Recent documents, newest first; vanished files are pruned, thumbnails read from each file. */
	recent(): RecentFile[] {
		return this.recents()
			.list()
			.map((entry) => ({ ...entry, thumbnail: this.readThumbnailFromDisk(entry.path) }));
	}

	clearRecent(): void {
		this.recents().clear();
		this.ctx.electron.app.clearRecentDocuments();
	}

	/** Store the sender's preview. The renderer draws it (see the renderer's thumbnail seam). */
	setThumbnail(sender: SenderHandle, thumbnail: Thumbnail): void {
		this.store.current(sender).writeThumbnail(FILE_THUMBNAIL_KEY, thumbnail);
	}

	/** Untitled documents are temporary and never listed; the OS list follows ours. */
	private recordRecent(info: StoreInfo): void {
		if (info.untitled) return;
		this.recents().record(info.path, info.name);
		this.ctx.electron.app.addRecentDocument(path.resolve(info.path));
	}

	private recents(): RecentFilesStore {
		if (this.recentStore === null) {
			const userData = this.ctx.electron.app.getPath('userData');
			this.recentStore = new RecentFilesStore(path.join(userData, RECENT_FILES_NAME));
		}
		return this.recentStore;
	}

	private readThumbnailFromDisk(file: string): Thumbnail | null {
		let peeked: DocumentFile | null = null;
		try {
			peeked = DocumentFile.open(file, { session: false });
			return peeked.readThumbnail(FILE_THUMBNAIL_KEY);
		} catch (error) {
			if (!(error instanceof StoreError)) throw error;
			return null;
		} finally {
			peeked?.close();
		}
	}

	// ---------- untitled documents and recovery ----------

	/** Untitled documents with edits that nothing has open: what a crash or a quit left behind. */
	recoverable(): RecoverableDocument[] {
		const directory = untitledDirectory(this.ctx.electron.app.getPath('userData'));
		const open = new Set(this.store.openPaths().map((file) => path.resolve(file)));
		const found: RecoverableDocument[] = [];
		for (const entry of this.untitledFiles(directory)) {
			if (open.has(path.resolve(entry))) continue;
			const document = this.inspect(entry);
			if (document !== null) found.push(document);
		}
		return found.sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	/**
	 * Ask whether to restore the newest recoverable untitled document (and the next ones, if the
	 * answer is no). Declined ones are deleted. Returns the restored document, or `null`.
	 */
	async offerRecovery(sender: SenderHandle): Promise<LoadedDocument | null> {
		for (const candidate of this.recoverable()) {
			const answer = await this.ctx.electron.dialog.showMessageBox({
				message: `Restore "${candidate.name}"?`,
				detail: `The app closed before this document was saved (last changed ${new Date(candidate.modifiedAt).toLocaleString()}).`,
				buttons: ['Restore', 'Discard'],
				defaultId: 0,
				cancelId: 1
			});
			if (answer !== 0) {
				removeFileAndSidecars(candidate.path);
				continue;
			}
			const info = await this.store.adopt(sender, () => DocumentFile.open(candidate.path));
			this.watchClose(sender);
			this.recordRecent(info);
			return this.loaded(sender, info);
		}
		return null;
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

	/** `app/before-quit`: persist every window's queue. A quit never prompts; see `onClose`. */
	async prepareToQuit(): Promise<void> {
		this.quitting = true;
		const withDocuments = this.ctx.electron
			.windows()
			.filter((window) => this.store.hasStore(window.sender));
		await Promise.all(withDocuments.map((window) => this.requestFlush(window)));
	}

	/**
	 * A window was asked to close: true lets it. A saved document never asks. An untitled one
	 * with edits asks to Save, Don't Save or Cancel; during a quit it is left in the untitled
	 * directory instead, to be offered for recovery at the next start.
	 */
	async onClose(window: WindowHandle): Promise<boolean> {
		if (this.quitting) return true;
		const sender = window.sender;
		const current = this.currentFile(sender);
		if (current === null) return true;
		if ((await this.settleCurrent(sender)) === 'cancel') return false;
		await this.store.close(sender);
		this.discardIfUntitled(current);
		return true;
	}

	// ---------- opening on the OS's request ----------

	/** The file this launch was asked to open, once. */
	takeLaunchRequest(): string | null {
		return this.launchPaths.shift() ?? null;
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

	/** From now on the sender's window asks this service before it closes. */
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

	private async flushSender(sender: SenderHandle): Promise<void> {
		if (!this.store.hasStore(sender)) return;
		const window = this.ctx.electron.windowFromSender(sender);
		if (window !== null) await this.requestFlush(window);
	}

	private currentFile(sender: SenderHandle): string | null {
		if (!this.store.hasStore(sender)) return null;
		return path.resolve(this.store.current(sender).path);
	}

	private loaded(sender: SenderHandle, info: StoreInfo): LoadedDocument {
		const file = this.store.current(sender);
		return { info, document: file.load() };
	}

	/**
	 * Before the sender's document goes away: let the renderer persist, then, for an untitled
	 * document with edits, ask what to do with them.
	 */
	private async settleCurrent(sender: SenderHandle): Promise<Decision> {
		if (!this.store.hasStore(sender)) return 'proceed';
		const window = this.ctx.electron.windowFromSender(sender);
		if (window !== null) await this.requestFlush(window);
		const file = this.store.current(sender);
		const info = this.store.infoOf(file);
		if (!info.untitled || !info.unsaved) return 'proceed';
		const choice = await this.ctx.electron.dialog.showMessageBox({
			message: `Save changes to "${info.name}"?`,
			detail: "Your changes will be lost if you don't save them.",
			buttons: ['Save…', "Don't Save", 'Cancel'],
			defaultId: SAVE_CHOICE,
			cancelId: 2
		});
		if (choice === DISCARD_CHOICE) return 'proceed';
		if (choice !== SAVE_CHOICE) return 'cancel';
		const destination = await this.saveDialog(info.name);
		if (destination === null) return 'cancel';
		await this.saveAs(sender, destination);
		return 'proceed';
	}

	private nextUntitledPath(): string {
		const directory = untitledDirectory(this.ctx.electron.app.getPath('userData'));
		mkdirSync(directory, { recursive: true });
		const unique = `${Date.now()}-${randomBytes(4).toString('hex')}`;
		return path.join(directory, `untitled-${unique}.${FILE_EXTENSION}`);
	}

	private isUntitled(file: string): boolean {
		const directory = untitledDirectory(this.ctx.electron.app.getPath('userData'));
		return path.dirname(path.resolve(file)) === path.resolve(directory);
	}

	/** Delete a temporary untitled file nobody needs any more. */
	private discardIfUntitled(file: string | null): void {
		if (file === null || !this.isUntitled(file)) return;
		removeFileAndSidecars(file);
	}

	private untitledFiles(directory: string): string[] {
		try {
			return readdirSync(directory)
				.filter((name) => name.endsWith(`.${FILE_EXTENSION}`))
				.map((name) => path.join(directory, name));
		} catch {
			return [];
		}
	}

	/** What a leftover untitled file holds; empty and unreadable ones are cleaned up. */
	private inspect(file: string): RecoverableDocument | null {
		let peeked: DocumentFile | null = null;
		try {
			peeked = DocumentFile.open(file, { session: false });
			const info = peeked.info();
			if (info.unsaved) return { path: file, name: info.name, modifiedAt: info.modifiedAt };
		} catch (error) {
			if (!(error instanceof StoreError)) throw error;
			this.ctx.logger.warn(
				`untitled file ${file} cannot be read and is left alone: ${error.message}`
			);
			return null;
		} finally {
			peeked?.close();
		}
		removeFileAndSidecars(file);
		return null;
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		files: FilesService;
	}
}

export const mainFilesPlugin: Plugin.Object<FilesConfig> = {
	name: 'main-files',
	inject: ['electron', 'ipc', 'store'],
	apply(ctx, config) {
		const files = new FilesService(ctx, config);

		route(ctx, 'files:newUntitled', (_payload, event) => files.newUntitled(event.sender));
		route(ctx, 'files:open', (request, event) => files.open(event.sender, request.path));
		route(ctx, 'files:openInTab', (request, event) => files.openInTab(event.sender, request.path));
		route(ctx, 'files:newInTab', (_payload, event) => files.newInTab(event.sender));
		route(ctx, 'files:confirmClose', (_payload, event) => files.confirmClose(event.sender));
		route(ctx, 'files:discard', (request) => files.discard(request.path));
		route(ctx, 'files:openDialog', () => files.openDialog());
		route(ctx, 'files:saveDialog', (request) => files.saveDialog(request.suggestedName));
		route(ctx, 'files:saveAs', (request, event) => files.saveAs(event.sender, request.path));
		route(ctx, 'files:offerRecovery', (_payload, event) => files.offerRecovery(event.sender));
		route(ctx, 'files:recent', () => files.recent());
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
