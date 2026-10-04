// The `fileSession` service: the link between the live document and the file on disk.
//
// Persistence. Every committed document transaction is queued and sent to main, where it becomes
// one SQLite transaction touching only the affected rows (autosave, no separate snapshot). The
// queue debounces, batches, applies backpressure and retries; see autosaveQueue.ts.
//
// Session. New, open, save and save as over the `files:*` IPC domain; the window title and dirty
// marker through context keys.
//
// Dirty semantics (data-model.md section 7: every transaction is persisted, so nothing is ever
// "unsaved in memory"):
//   dirty = a transaction was committed since the last Save (or since the file was opened,
//   unless it was opened with edits nobody ever saved, which counts as dirty from the start).
//   Edits are persisted either way, so a dirty *saved* document never asks anything on close.
//   Only an untitled document with edits asks (main does: Save / Don't Save / Cancel), because
//   leaving it would throw the work away. Undo back to the saved content is still dirty.

import { Service, type Context } from '@neoworks/extension-system';
import type { CommitResult, LoadedDocument, StoreInfo } from '../../../electron/bridge';
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
	storeCheckpoint(): Promise<StoreInfo>;
	filesNewUntitled(): Promise<LoadedDocument | null>;
	filesOpen(path: string): Promise<LoadedDocument | null>;
	filesOpenDialog(): Promise<string | null>;
	filesSaveDialog(suggestedName: string): Promise<string | null>;
	filesSaveAs(path: string): Promise<StoreInfo>;
	filesOfferRecovery(): Promise<LoadedDocument | null>;
	filesLaunchRequest(): Promise<string | null>;
	filesFlushed(requestId: string): Promise<void>;
}

export interface FileSessionOptions {
	/** Debounce before a queued transaction is sent. */
	delayMs?: number;
	/** Most transactions per IPC message. */
	maxBatch?: number;
	/** `auto` (default) opens the launch file, offers recovery, or starts an untitled document. */
	startup?: 'auto' | 'none';
	/** Test seam: replaces the timers of the autosave queue. */
	schedule?: (callback: () => void, delayMs: number) => unknown;
	cancel?: (handle: unknown) => void;
}

export const DEFAULT_AUTOSAVE_DELAY_MS = 50;
export const DEFAULT_AUTOSAVE_BATCH = 200;
export const DEFAULT_DOCUMENT_NAME = 'Untitled';

export class FileSessionService extends Service {
	private readonly queue: AutosaveQueue;
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
			onStatus: (status) => {
				this.state.status = status;
			}
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

	get isUntitled(): boolean {
		const info = this.state.info;
		return info !== null && info.untitled;
	}

	/** Committed changes since the last Save; see the dirty semantics at the top of this file. */
	get dirty(): boolean {
		if (this.state.info === null) return false;
		return this.document.revision !== this.state.savedRevision;
	}

	/** Autosave progress: queued, in flight, last error, persisted count. */
	get status(): AutosaveStatus {
		return this.state.status;
	}

	// ---------- persistence ----------

	/** Start persisting document changes into the file `info` describes. */
	attach(info: StoreInfo): void {
		this.state.info = info;
		this.state.savedRevision = info.unsaved ? -1 : this.document.revision;
		this.publishKeys();
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
		this.publishKeys();
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

	// ---------- the session: new, open, save, save as ----------

	/** Replace the document with a new untitled one. False when the user cancelled. */
	async newDocument(): Promise<boolean> {
		await this.settleQueue();
		const loaded = await this.desktop.filesNewUntitled();
		if (loaded === null) return false;
		this.adopt(loaded);
		return true;
	}

	/** Open a design file (asking for one when `path` is omitted). False when cancelled. */
	async openDocument(path?: string): Promise<boolean> {
		const chosen = path === undefined ? await this.desktop.filesOpenDialog() : path;
		if (chosen === null) return false;
		await this.settleQueue();
		const loaded = await this.desktop.filesOpen(chosen);
		if (loaded === null) return false;
		this.adopt(loaded);
		return true;
	}

	/** Save: checkpoint the file. An untitled document needs a place first (Save As). */
	async save(): Promise<boolean> {
		const info = this.requireInfo();
		if (info.untitled) return this.saveAs();
		await this.flush();
		const revision = this.document.revision;
		this.state.info = await this.desktop.storeCheckpoint();
		this.state.savedRevision = revision;
		this.publishKeys();
		return true;
	}

	/** Save a copy under `path` (asking when omitted) and keep editing that copy. */
	async saveAs(path?: string): Promise<boolean> {
		this.requireInfo();
		const destination =
			path === undefined ? await this.desktop.filesSaveDialog(this.displayName) : path;
		if (destination === null) return false;
		await this.flush();
		const revision = this.document.revision;
		this.state.info = await this.desktop.filesSaveAs(destination);
		this.state.savedRevision = revision;
		this.publishKeys();
		return true;
	}

	/**
	 * What the window shows at launch: the file the launch named, else an untitled document a
	 * crash left behind (main asks whether to restore it), else a new untitled document.
	 */
	async startup(isCancelled: () => boolean = () => false): Promise<void> {
		const launchPath = await this.desktop.filesLaunchRequest();
		if (isCancelled()) return;
		if (launchPath !== null) {
			await this.openDocument(launchPath);
			return;
		}
		const recovered = await this.desktop.filesOfferRecovery();
		if (isCancelled()) return;
		if (recovered !== null) {
			this.adopt(recovered);
			return;
		}
		await this.newDocument();
	}

	/** Unset every context key this service published; for plugin unmount. */
	clearKeys(): void {
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

	private requireInfo(): StoreInfo {
		const info = this.state.info;
		if (info === null) throw new Error('no document file is open');
		return info;
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
		this.setKey('document.dirty', this.dirty);
		this.setKey('document.untitled', this.isUntitled);
	}

	private setKey(key: string, value: unknown): void {
		this.publishedKeys.set(key, this.contextKeys.set(key, value));
	}
}
