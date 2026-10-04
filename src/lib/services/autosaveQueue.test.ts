import { describe, expect, it } from 'vitest';
import type { Transaction } from '../document';
import { AutosaveQueue, type AutosaveStatus } from './autosaveQueue';

function transaction(id: string): Transaction {
	return { id, origin: 'user', label: id, changes: [], undo: [] };
}

/** Timers the test advances by hand. */
class ManualTimers {
	private next = 1;
	readonly pending = new Map<number, { callback: () => void; delayMs: number }>();

	schedule = (callback: () => void, delayMs: number): unknown => {
		const handle = this.next;
		this.next += 1;
		this.pending.set(handle, { callback, delayMs });
		return handle;
	};
	cancel = (handle: unknown): void => {
		this.pending.delete(handle as number);
	};
	get delays(): number[] {
		return [...this.pending.values()].map((timer) => timer.delayMs);
	}
	/** Fire everything currently scheduled. */
	fire(): void {
		const due = [...this.pending.entries()];
		this.pending.clear();
		for (const [, timer] of due) timer.callback();
	}
}

/** A `send` the test settles by hand, recording every batch. */
class ManualSend {
	readonly batches: string[][] = [];
	private resolvers: { resolve: () => void; reject: (error: Error) => void }[] = [];
	concurrent = 0;
	maxConcurrent = 0;

	send = (batch: Transaction[]): Promise<void> => {
		this.batches.push(batch.map((entry) => entry.id));
		this.concurrent += 1;
		this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
		return new Promise<void>((resolve, reject) => {
			this.resolvers.push({
				resolve: () => {
					this.concurrent -= 1;
					resolve();
				},
				reject: (error) => {
					this.concurrent -= 1;
					reject(error);
				}
			});
		});
	};
	get waiting(): number {
		return this.resolvers.length;
	}
	succeed(): void {
		this.resolvers.shift()?.resolve();
	}
	fail(message: string): void {
		this.resolvers.shift()?.reject(new Error(message));
	}
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function build(options: { maxBatch?: number } = {}): {
	queue: AutosaveQueue;
	timers: ManualTimers;
	sender: ManualSend;
	statuses: AutosaveStatus[];
} {
	const timers = new ManualTimers();
	const sender = new ManualSend();
	const statuses: AutosaveStatus[] = [];
	const queue = new AutosaveQueue({
		delayMs: 50,
		maxBatch: options.maxBatch ?? 100,
		send: sender.send,
		schedule: timers.schedule,
		cancel: timers.cancel,
		onStatus: (status) => statuses.push(status)
	});
	return { queue, timers, sender, statuses };
}

describe('debounce and batching', () => {
	it('waits for the delay and sends a burst as one message in order', async () => {
		const { queue, timers, sender } = build();
		queue.enqueue(transaction('a'));
		queue.enqueue(transaction('b'));
		queue.enqueue(transaction('c'));
		expect(sender.batches).toEqual([]);
		expect(timers.delays).toEqual([50]);
		timers.fire();
		expect(sender.batches).toEqual([['a', 'b', 'c']]);
		sender.succeed();
		await settle();
		expect(queue.status).toEqual({ queued: 0, inFlight: 0, error: null, persisted: 3 });
	});

	it('splits a backlog into batches of at most maxBatch', async () => {
		const { queue, timers, sender } = build({ maxBatch: 2 });
		for (const id of ['a', 'b', 'c', 'd', 'e']) queue.enqueue(transaction(id));
		timers.fire();
		sender.succeed();
		await settle();
		timers.fire();
		sender.succeed();
		await settle();
		timers.fire();
		sender.succeed();
		await settle();
		expect(sender.batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
		expect(queue.status.persisted).toBe(5);
	});
});

describe('backpressure', () => {
	it('never has two messages in flight; later transactions wait and go out next, in order', async () => {
		const { queue, timers, sender } = build();
		queue.enqueue(transaction('a'));
		timers.fire();
		expect(sender.waiting).toBe(1);

		queue.enqueue(transaction('b'));
		queue.enqueue(transaction('c'));
		expect(timers.pending.size).toBe(0);
		expect(sender.batches).toEqual([['a']]);
		expect(queue.status).toMatchObject({ queued: 2, inFlight: 1 });

		sender.succeed();
		await settle();
		expect(timers.delays).toEqual([0]);
		timers.fire();
		expect(sender.batches).toEqual([['a'], ['b', 'c']]);
		sender.succeed();
		await settle();
		expect(sender.maxConcurrent).toBe(1);
		expect(queue.status).toMatchObject({ queued: 0, inFlight: 0, persisted: 3 });
	});
});

describe('failure and retry', () => {
	it('keeps the batch, reports the error, retries with growing delays, loses nothing', async () => {
		const { queue, timers, sender } = build();
		queue.enqueue(transaction('a'));
		queue.enqueue(transaction('b'));
		timers.fire();
		sender.fail('main is busy');
		await settle();
		expect(queue.status).toMatchObject({ error: 'main is busy', inFlight: 2, persisted: 0 });
		expect(timers.delays).toEqual([1000]);

		queue.enqueue(transaction('c'));
		timers.fire();
		sender.fail('still busy');
		await settle();
		expect(timers.delays).toEqual([2000]);

		timers.fire();
		sender.succeed();
		await settle();
		expect(queue.status).toMatchObject({ error: null, inFlight: 0, persisted: 2 });
		timers.fire();
		sender.succeed();
		await settle();
		expect(sender.batches).toEqual([['a', 'b'], ['a', 'b'], ['a', 'b'], ['c']]);
		expect(queue.status.persisted).toBe(3);
	});

	it('caps the retry delay', async () => {
		const { queue, timers, sender } = build();
		queue.enqueue(transaction('a'));
		timers.fire();
		const delays: number[] = [];
		for (let attempt = 0; attempt < 6; attempt += 1) {
			sender.fail('down');
			await settle();
			delays.push(...timers.delays);
			timers.fire();
		}
		expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
	});
});

describe('flush and dispose', () => {
	it('flush sends everything now, including what is in flight, and resolves when persisted', async () => {
		const { queue, timers, sender } = build({ maxBatch: 2 });
		for (const id of ['a', 'b', 'c']) queue.enqueue(transaction(id));
		const flushed = queue.flush();
		expect(timers.pending.size).toBe(0);
		expect(sender.batches).toEqual([['a', 'b']]);
		sender.succeed();
		await settle();
		expect(sender.batches).toEqual([['a', 'b'], ['c']]);
		sender.succeed();
		await flushed;
		expect(queue.status).toMatchObject({ queued: 0, inFlight: 0, persisted: 3 });
	});

	it('flush on an empty queue resolves at once', async () => {
		const { queue } = build();
		await queue.flush();
	});

	it('flush rejects when sending fails and keeps the transactions', async () => {
		const { queue, sender } = build();
		queue.enqueue(transaction('a'));
		const flushed = queue.flush();
		sender.fail('disk full');
		await expect(flushed).rejects.toThrow('disk full');
		expect(queue.status).toMatchObject({ inFlight: 1, error: 'disk full' });
	});

	it('dispose cancels the timer and ignores later transactions', () => {
		const { queue, timers, sender } = build();
		queue.enqueue(transaction('a'));
		expect(timers.pending.size).toBe(1);
		queue.dispose();
		expect(timers.pending.size).toBe(0);
		queue.enqueue(transaction('b'));
		expect(timers.pending.size).toBe(0);
		expect(sender.batches).toEqual([]);
	});

	it('reports every status change', async () => {
		const { queue, timers, sender, statuses } = build();
		queue.enqueue(transaction('a'));
		timers.fire();
		sender.succeed();
		await settle();
		expect(
			statuses.map((status) => `${status.queued}/${status.inFlight}/${status.persisted}`)
		).toEqual(['1/0/0', '0/1/0', '0/0/1']);
	});
});
