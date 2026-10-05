// The renderer's side of incremental persistence: committed transactions are queued, coalesced
// while a message is in flight, and sent to main in order.
//
// Policy:
//   debounce      a transaction waits `delayMs` so a burst (a drag) goes out as one message
//   batching      at most `maxBatch` transactions per message
//   backpressure  one message in flight; whatever arrives meanwhile queues up and goes out as
//                 the next batch the moment the reply is in, so a slow main never gets
//                 overlapping writes and the queue never reorders
//   failure       the batch stays at the front of the queue, `status.error` is set, and sending
//                 retries after a growing delay (1 s, 2 s, ... capped); nothing is dropped
//   flush         `flush()` sends everything now and rejects with the error if it still fails
//
// Timers are injected so tests drive time; `dispose()` cancels the pending one.

import type { Transaction } from '../document';

export interface AutosaveStatus {
	/** Transactions waiting, not counting the batch in flight. */
	queued: number;
	/** Transactions in the message currently on its way to main. */
	inFlight: number;
	/** Message of the last failed send; cleared by the next success. */
	error: string | null;
	/** Transactions confirmed persisted since the queue was created. */
	persisted: number;
}

export interface AutosaveQueueOptions {
	delayMs: number;
	maxBatch: number;
	send: (batch: Transaction[]) => Promise<unknown>;
	schedule?: (callback: () => void, delayMs: number) => unknown;
	cancel?: (handle: unknown) => void;
	onStatus?: (status: AutosaveStatus) => void;
	/** First retry delay after a failed send; doubles up to `maxRetryDelayMs`. */
	retryDelayMs?: number;
	maxRetryDelayMs?: number;
}

const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 8000;

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class AutosaveQueue {
	private queue: Transaction[] = [];
	private inFlight: Transaction[] = [];
	private timer: unknown = undefined;
	private hasTimer = false;
	private sending: Promise<void> | null = null;
	private error: string | null = null;
	private persisted = 0;
	private failures = 0;
	private disposed = false;

	constructor(private readonly options: AutosaveQueueOptions) {}

	get status(): AutosaveStatus {
		return {
			queued: this.queue.length,
			inFlight: this.inFlight.length,
			error: this.error,
			persisted: this.persisted
		};
	}

	enqueue(transaction: Transaction): void {
		if (this.disposed) return;
		this.queue.push(transaction);
		this.publish();
		if (this.sending === null) this.arm(this.options.delayMs);
	}

	/** Send everything queued, now. Rejects with the send error if it fails. */
	async flush(): Promise<void> {
		this.disarm();
		for (;;) {
			if (this.sending !== null) await this.sending;
			if (this.queue.length === 0 && this.inFlight.length === 0) return;
			await this.sendNext();
			if (this.error !== null) throw new Error(this.error);
		}
	}

	/** Forget everything queued, failed or not (its file is gone); the queue stays usable. */
	discard(): void {
		this.disarm();
		this.queue = [];
		this.inFlight = [];
		this.error = null;
		this.failures = 0;
		this.publish();
	}

	/** Stop timers. Unsent transactions are discarded: call `flush()` first if they matter. */
	dispose(): void {
		this.disposed = true;
		this.disarm();
		this.queue = [];
		this.publish();
	}

	private arm(delayMs: number): void {
		if (this.hasTimer || this.disposed) return;
		const schedule = this.options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
		this.hasTimer = true;
		this.timer = schedule(() => {
			this.hasTimer = false;
			void this.sendNext();
		}, delayMs);
	}

	private disarm(): void {
		if (!this.hasTimer) return;
		const cancel =
			this.options.cancel ??
			((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		cancel(this.timer);
		this.hasTimer = false;
	}

	/** Send the next batch (or retry the failed one); resolves when its reply is processed. */
	private sendNext(): Promise<void> {
		if (this.sending !== null) return this.sending;
		if (this.inFlight.length === 0) {
			if (this.queue.length === 0) return Promise.resolve();
			this.inFlight = this.queue.splice(0, this.options.maxBatch);
		}
		const batch = this.inFlight;
		this.publish();
		const attempt = this.options
			.send(batch)
			.then(() => this.sent(batch.length))
			.catch((error: unknown) => this.failed(error))
			.finally(() => {
				this.sending = null;
			});
		this.sending = attempt;
		return attempt;
	}

	private sent(count: number): void {
		this.persisted += count;
		this.inFlight = [];
		this.error = null;
		this.failures = 0;
		this.publish();
		if (this.queue.length > 0) this.arm(0);
	}

	private failed(error: unknown): void {
		this.error = describe(error);
		this.failures += 1;
		this.publish();
		const base = this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		const cap = this.options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
		this.arm(Math.min(base * 2 ** (this.failures - 1), cap));
	}

	private publish(): void {
		this.options.onStatus?.(this.status);
	}
}
