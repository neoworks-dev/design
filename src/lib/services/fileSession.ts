// The `fileSession` service: the link between the live document and the file on disk.
//
// This part is persistence: every committed document transaction is queued and sent to main,
// where it becomes one SQLite transaction touching only the affected rows (autosave, no separate
// snapshot). The queue debounces, batches, applies backpressure and retries; see autosaveQueue.ts.

import { Service, type Context } from '@neoworks/extension-system';
import type { CommitResult, StoreInfo } from '../../../electron/bridge';
import type { DocumentChangeEvent, Transaction } from '../document';
import { AutosaveQueue, type AutosaveStatus } from './autosaveQueue';
import type { FileSessionState } from './fileSessionState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		fileSession: FileSessionService;
	}
}

/** The part of the `desktop` service the session uses (the library may not import plugins). */
export interface FileSessionDesktop {
	storeCommit(transactions: Transaction[]): Promise<CommitResult>;
}

export interface FileSessionOptions {
	/** Debounce before a queued transaction is sent. */
	delayMs?: number;
	/** Most transactions per IPC message. */
	maxBatch?: number;
	/** Test seam: replaces the timers of the autosave queue. */
	schedule?: (callback: () => void, delayMs: number) => unknown;
	cancel?: (handle: unknown) => void;
}

export const DEFAULT_AUTOSAVE_DELAY_MS = 50;
export const DEFAULT_AUTOSAVE_BATCH = 200;

export class FileSessionService extends Service {
	private readonly queue: AutosaveQueue;

	/** `desktop` is captured at construction (the providing plugin injects it). */
	constructor(
		ctx: Context,
		private readonly desktop: FileSessionDesktop,
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
	}

	// ---------- reads (reactive) ----------

	/** The file this window edits, as main last reported it; `null` when none is attached. */
	get info(): StoreInfo | null {
		return this.state.info;
	}

	get isAttached(): boolean {
		return this.state.info !== null;
	}

	/** Autosave progress: queued, in flight, last error, persisted count. */
	get status(): AutosaveStatus {
		return this.state.status;
	}

	// ---------- persistence ----------

	/** Start persisting document changes into the file `info` describes. */
	attach(info: StoreInfo): void {
		this.state.info = info;
	}

	/** Stop persisting. Pending transactions are sent first so none are lost. */
	async detach(): Promise<void> {
		if (this.state.info === null) return;
		await this.flush();
		this.state.info = null;
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

	/** Stop the autosave timers; for plugin unmount, after a best-effort flush. */
	stop(): void {
		this.queue.dispose();
	}

	snapshotState(): Record<string, unknown> {
		return { attached: this.state.info !== null, queued: this.state.status.queued };
	}
}
