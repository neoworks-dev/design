// The `fileSession` service: the link between the live document and the file on disk.
//
// Persistence. Every committed document transaction is queued and sent to main, where it becomes
// one SQLite transaction touching only the affected rows (autosave, no separate snapshot). The
// queue debounces, batches, applies backpressure and retries; see autosaveQueue.ts.
//
// Session. New, open, rename and save a copy over the `files:*` and `library:*` IPC domains; the
// window title through a context key. There is no dirty state and nothing ever asks to save:
// every file lives in the library (or wherever it was opened) from the moment it exists, and
// every change is persisted a few milliseconds after it happens. "Save" only flushes the queue.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	CommitResult,
	FileMovedMessage,
	LibraryFile,
	LoadedDocument,
	StoreInfo
} from '../../../electron/bridge';
import type { DocumentChangeEvent, Transaction } from '../document';
import type { ContextKeysService } from '../registries/contextKeys.svelte';
import { AutosaveQueue, type AutosaveStatus } from './autosaveQueue';
import type { DocumentService } from './document';
import type { FileSessionState } from './fileSessionState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		fileSession: FileSessionService;
	}
}

/** The part of the `desktop` service the session uses (the library may not import plugins). */
export interface FileSessionDesktop {
	storeCommit(transactions: Transaction[]): Promise<CommitResult>;
	storeClose(): Promise<void>;
	filesNew(directory?: string): Promise<LoadedDocument>;
	filesOpen(path: string): Promise<LoadedDocument>;
	filesOpenDialog(): Promise<string | null>;
	filesSaveDialog(suggestedName: string): Promise<string | null>;
	filesSaveAs(path: string): Promise<StoreInfo>;
	filesLaunchRequest(): Promise<string | null>;
	filesFlushed(requestId: string): Promise<void>;
	libraryRenameFile(path: string, name: string): Promise<LibraryFile>;
}

export interface FileSessionOptions {
	/** Debounce before a queued transaction is sent. */
	delayMs?: number;
	/** Most transactions per IPC message. */
	maxBatch?: number;
	/** `auto` (default) opens the file the launch named; with none the home screen shows. */
	startup?: 'auto' | 'none';
	/** Test seam: replaces the timers of the autosave queue. */
	schedule?: (callback: () => void, delayMs: number) => unknown;
	cancel?: (handle: unknown) => void;
}

export const DEFAULT_AUTOSAVE_DELAY_MS = 50;
export const DEFAULT_AUTOSAVE_BATCH = 200;
export const DEFAULT_DOCUMENT_NAME = 'Untitled';
const FILE_EXTENSION = '.ndesign';

/** The file name without directory and `.ndesign`, for either path separator. */
export function nameOfPath(path: string): string {
	const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const base = path.slice(separator + 1);
	if (base.endsWith(FILE_EXTENSION)) return base.slice(0, -FILE_EXTENSION.length);
	return base;
}

export class FileSessionService extends Service {
	private readonly queue: AutosaveQueue;
	private lastPersisted = 0;
	private keysCleared = false;
	private readonly publishedKeys = new Map<string, () => void>();

	/** Dependencies are captured at construction (the providing plugin injects them). */
	constructor(
		ctx: Context,
		private readonly desktop: FileSessionDesktop,
		private readonly document: DocumentService,
		private readonly contextKeys: ContextKeysService,
		private readonly state: FileSessionState,
		options: FileSessionOptions = {}
	) {
		super(ctx, 'fileSession');
		this.queue = new AutosaveQueue({
			delayMs: options.delayMs ?? DEFAULT_AUTOSAVE_DELAY_MS,
			maxBatch: options.maxBatch ?? DEFAULT_AUTOSAVE_BATCH,
			send: (batch) => this.desktop.storeCommit(batch),
			schedule: options.schedule,
			cancel: options.cancel,
			onStatus: (status) => this.onQueueStatus(status)
		});
		this.publishKeys();
	}

	// ---------- reads (reactive) ----------

	/** The file this window edits, as main last reported it; `null` when none is attached. */
	get info(): StoreInfo | null {
		return this.state.info;
	}

	get isAttached(): boolean {
		return this.state.info !== null;
	}

	/** The name shown in the title bar: the file's name, `Untitled` before any file. */
	get displayName(): string {
		const info = this.state.info;
		if (info === null) return DEFAULT_DOCUMENT_NAME;
		return info.name;
	}

	/** Whether the file lives in the Draftboard library rather than somewhere else. */
	get inLibrary(): boolean {
		const info = this.state.info;
		return info !== null && info.inLibrary;
	}

	/** Whether changes are waiting for or on their way to disk. */
	get isSaving(): boolean {
		const status = this.state.status;
		return status.queued > 0 || status.inFlight > 0;
	}

	/** Autosave progress: queued, in flight, last error, persisted count. */
	get status(): AutosaveStatus {
		return this.state.status;
	}

	// ---------- persistence ----------

	/** Start persisting document changes into the file `info` describes. */
	attach(info: StoreInfo): void {
		this.state.info = info;
		this.state.closed = false;
		this.publishKeys();
		this.ctx.emit('file/attached', info);
	}

	/** Stop persisting. Pending transactions are sent first so none are lost. */
	async detach(): Promise<void> {
		if (this.state.info === null) return;
		await this.flush();
		this.state.info = null;
		this.publishKeys();
	}

	/** `document/change`: queue the committed transaction for the file, if one is attached. */
	record(event: DocumentChangeEvent): void {
		if (this.state.info === null) return;
		this.queue.enqueue(event.transaction);
	}

	/** Send everything queued now; rejects when main cannot be reached or refuses. */
	flush(): Promise<void> {
		return this.queue.flush();
	}

	/** Main asked for a flush (window close, quit): persist, then confirm. */
	async answerFlushRequest(requestId: string): Promise<void> {
		await this.flush().catch(() => undefined);
		await this.desktop.filesFlushed(requestId);
	}

	/** Stop the autosave timers; for plugin unmount. */
	stop(): void {
		this.queue.dispose();
	}

	// ---------- the session: new, open, rename, save a copy ----------

	/** Create a new document in `directory` (the library root by default) and show it. */
	async newDocument(directory?: string): Promise<boolean> {
		if ((await this.ctx.serial('file/open-request', { kind: 'new', directory })) === true) {
			return true;
		}
		await this.settleQueue();
		this.adopt(await this.desktop.filesNew(directory));
		return true;
	}

	/** Open a design file (asking for one when `path` is omitted). False when cancelled. */
	async openDocument(path?: string): Promise<boolean> {
		const chosen = path === undefined ? await this.desktop.filesOpenDialog() : path;
		if (chosen === null) return false;
		if ((await this.ctx.serial('file/open-request', { kind: 'open', path: chosen })) === true) {
			return true;
		}
		await this.openInTab(chosen);
		return true;
	}

	// ---------- tabs: documents are switched, not replaced ----------

	/** Make the design file at `path` the live document; the one it had stays on disk as a tab. */
	async openInTab(path: string): Promise<void> {
		await this.settleQueue();
		this.adopt(await this.desktop.filesOpen(path));
	}

	/** Make a new document the live one; the previous one stays as a tab. */
	async newInTab(directory?: string): Promise<void> {
		await this.settleQueue();
		this.adopt(await this.desktop.filesNew(directory));
	}

	/** Close the live document and show no document (the home screen). */
	async closeDocument(): Promise<void> {
		await this.detach();
		await this.desktop.storeClose();
		this.state.closed = true;
		this.publishKeys();
	}

	/** Show no document because there is none left (its file is gone); nothing is flushed. */
	releaseDocument(): void {
		this.queue.discard();
		this.state.info = null;
		this.state.closed = true;
		this.publishKeys();
	}

	/** Save: persist what is queued. The file is a real file already; no dialog, no prompt. */
	async save(): Promise<void> {
		await this.flush();
	}

	/** Rename the open file on disk. */
	async rename(name: string): Promise<void> {
		const info = this.state.info;
		if (info === null) return;
		await this.flush();
		const renamed = await this.desktop.libraryRenameFile(info.path, name);
		this.handleMoved({ from: info.path, to: renamed.path });
	}

	/** Save a copy under `path` (asking when omitted) and keep editing that copy. */
	async saveAs(path?: string): Promise<boolean> {
		if (this.state.info === null) return false;
		const destination =
			path === undefined ? await this.desktop.filesSaveDialog(this.displayName) : path;
		if (destination === null) return false;
		await this.flush();
		const saved = await this.desktop.filesSaveAs(destination);
		this.state.info = saved;
		this.publishKeys();
		this.ctx.emit('file/attached', saved);
		return true;
	}

	/**
	 * A file was renamed, moved or trashed (here or in another window): the attached file follows,
	 * a trashed one is released without writing to it. Tabs and the home screen hear `file/moved`.
	 */
	handleMoved(message: FileMovedMessage): void {
		const info = this.state.info;
		if (info !== null && info.path === message.from) this.followMove(info, message.to);
		this.ctx.emit('file/moved', message);
	}

	/** What the window shows at launch: the file the launch named, else nothing (the home screen). */
	async startup(isCancelled: () => boolean = () => false): Promise<void> {
		const launchPath = await this.desktop.filesLaunchRequest();
		if (isCancelled()) return;
		if (launchPath === null) return;
		await this.openDocument(launchPath);
	}

	/** Unset every context key this service published; for plugin unmount. */
	clearKeys(): void {
		this.keysCleared = true;
		for (const dispose of this.publishedKeys.values()) dispose();
		this.publishedKeys.clear();
	}

	snapshotState(): Record<string, unknown> {
		return {
			attached: this.state.info !== null,
			queued: this.state.status.queued,
			keys: [...this.publishedKeys.keys()].sort()
		};
	}

	// ---------- internals ----------

	private onQueueStatus(status: AutosaveStatus): void {
		this.state.status = status;
		this.setKey('document.saving', this.isSaving);
		const idle = status.queued === 0 && status.inFlight === 0;
		if (!idle || status.persisted === this.lastPersisted) return;
		this.lastPersisted = status.persisted;
		const info = this.state.info;
		if (info !== null) this.ctx.emit('file/saved', info);
	}

	private followMove(info: StoreInfo, to: string | null): void {
		if (to === null) {
			this.releaseDocument();
			return;
		}
		this.state.info = { ...info, path: to, name: nameOfPath(to) };
		this.publishKeys();
	}

	/** Persist what is queued for the file about to be left; with no file there is nothing. */
	private async settleQueue(): Promise<void> {
		if (this.state.info === null) return;
		await this.flush();
	}

	/** Make a document main loaded the live one, and attach its file. */
	private adopt(loaded: LoadedDocument): void {
		this.document.replaceDocument(loaded.document);
		this.attach(loaded.info);
	}

	private publishKeys(): void {
		this.setKey('document.title', this.displayName);
		this.setKey('document.closed', this.state.closed);
		this.setKey('document.renamable', this.state.info !== null);
		this.setKey('document.saving', this.isSaving);
	}

	private setKey(key: string, value: unknown): void {
		if (this.keysCleared) return;
		this.publishedKeys.set(key, this.contextKeys.set(key, value));
	}
}
