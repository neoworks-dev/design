import { describe, expect, it } from 'vitest';
import {
	exceedsSize,
	RpcChannel,
	RpcClosedError,
	RpcError,
	RpcTimeoutError,
	type RpcEndpoint,
	type RpcMessage,
	type RpcOptions
} from './rpc';

/** Two channels joined by in-memory pipes; messages arrive asynchronously, cloned. */
function pair(
	left: Partial<RpcOptions> & Pick<RpcOptions, 'handler'>,
	right: Partial<RpcOptions> & Pick<RpcOptions, 'handler'>
): { left: RpcChannel; right: RpcChannel; sentByLeft: RpcMessage[] } {
	const leftListeners = new Set<(message: unknown) => void>();
	const rightListeners = new Set<(message: unknown) => void>();
	const sentByLeft: RpcMessage[] = [];
	const endpoint = (
		mine: Set<(message: unknown) => void>,
		theirs: Set<(message: unknown) => void>,
		log?: RpcMessage[]
	): RpcEndpoint => ({
		post: (message) => {
			log?.push(message);
			const copy = structuredClone(message);
			queueMicrotask(() => theirs.forEach((listener) => listener(copy)));
		},
		listen: (handler) => {
			mine.add(handler);
			return () => mine.delete(handler);
		}
	});
	return {
		left: new RpcChannel(endpoint(leftListeners, rightListeners, sentByLeft), left),
		right: new RpcChannel(endpoint(rightListeners, leftListeners), right),
		sentByLeft
	};
}

const echo = { handler: (_method: string, params: unknown): unknown => params };

describe('RpcChannel', () => {
	it('answers requests in both directions', async () => {
		const { left, right } = pair(
			{ handler: (method, params) => `left:${method}:${String(params)}` },
			{ handler: (method, params) => `right:${method}:${String(params)}` }
		);
		expect(await left.request('a', 1)).toBe('right:a:1');
		expect(await right.request('b', 2)).toBe('left:b:2');
	});

	it('rejects with the other side`s error name and message', async () => {
		const { left } = pair(echo, {
			handler: () => {
				throw new RangeError('out of range');
			}
		});
		const error = await left.request('x').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RpcError);
		expect((error as RpcError).remoteName).toBe('RangeError');
		expect((error as RpcError).message).toBe('out of range');
	});

	it('delivers events without a response', async () => {
		const seen: unknown[] = [];
		const { left } = pair(echo, {
			handler: () => undefined,
			onEvent: (name, payload) => seen.push([name, payload])
		});
		left.emit('selectionchange', { ids: ['a'] });
		await Promise.resolve();
		await Promise.resolve();
		expect(seen).toEqual([['selectionchange', { ids: ['a'] }]]);
	});

	it('refuses oversized requests on the sending side and never posts them', async () => {
		const { left, sentByLeft } = pair({ ...echo, maxMessageBytes: 100 }, echo);
		await expect(left.request('big', 'x'.repeat(500))).rejects.toThrow('larger than 100 bytes');
		expect(sentByLeft).toEqual([]);
	});

	it('answers an oversized incoming request with an error instead of handling it', async () => {
		let handled = 0;
		const { left } = pair(
			{ ...echo, maxMessageBytes: 10_000 },
			{
				handler: () => {
					handled += 1;
				},
				maxMessageBytes: 100
			}
		);
		await expect(left.request('big', 'x'.repeat(500))).rejects.toThrow('too large');
		expect(handled).toBe(0);
	});

	it('queues requests beyond the in-flight limit and sends them as answers arrive', async () => {
		const releases: (() => void)[] = [];
		const { left, sentByLeft } = pair(
			{ ...echo, maxInFlight: 2 },
			{
				handler: () =>
					new Promise<string>((resolve) => {
						releases.push(() => resolve('done'));
					})
			}
		);
		const answers = [left.request('a'), left.request('b'), left.request('c')];
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(sentByLeft).toHaveLength(2);
		expect(left.outstanding).toBe(3);
		releases.shift()?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(sentByLeft).toHaveLength(3);
		while (releases.length > 0) releases.shift()?.();
		expect(await Promise.all(answers)).toEqual(['done', 'done', 'done']);
	});

	it('refuses requests of the other side beyond the incoming limit', async () => {
		const releases: (() => void)[] = [];
		const { left } = pair(echo, {
			handler: () =>
				new Promise<void>((resolve) => {
					releases.push(resolve);
				}),
			maxIncoming: 1
		});
		const first = left.request('a');
		const second = left.request('b');
		await expect(second).rejects.toThrow('too many requests');
		releases.shift()?.();
		await first;
	});

	it('times out a request that gets no answer', async () => {
		const { left } = pair({ ...echo, timeoutMs: 20 }, { handler: () => new Promise(() => {}) });
		await expect(left.request('slow')).rejects.toBeInstanceOf(RpcTimeoutError);
	});

	it('rejects everything outstanding when closed and refuses new requests', async () => {
		const { left } = pair(echo, { handler: () => new Promise(() => {}) });
		const outstanding = left.request('hang');
		left.close('plugin unloaded');
		await expect(outstanding).rejects.toBeInstanceOf(RpcClosedError);
		await expect(left.request('again')).rejects.toThrow('plugin unloaded');
		expect(left.isClosed).toBe(true);
	});

	it('ignores messages that are not RPC messages', () => {
		const listeners = new Set<(message: unknown) => void>();
		const channel = new RpcChannel(
			{
				post: () => {},
				listen: (handler) => {
					listeners.add(handler);
					return () => listeners.delete(handler);
				}
			},
			echo
		);
		for (const listener of listeners) listener({ hello: 'world' });
		for (const listener of listeners) listener(null);
		expect(channel.outstanding).toBe(0);
		expect(channel.isClosed).toBe(false);
	});
});

describe('exceedsSize', () => {
	it('counts strings, binary data and nested values, and stops at the limit', () => {
		expect(exceedsSize('abc', 10)).toBe(false);
		expect(exceedsSize('x'.repeat(11), 10)).toBe(true);
		expect(exceedsSize(new Uint8Array(20), 10)).toBe(true);
		expect(exceedsSize({ list: ['a', 'b'], n: 1 }, 100)).toBe(false);
		expect(exceedsSize({ list: Array.from({ length: 100 }, () => 'abcdef') }, 100)).toBe(true);
	});

	it('does not loop on cycles and refuses absurd depth', () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(exceedsSize(cycle, 1000)).toBe(false);
		let deep: unknown = 'x';
		for (let level = 0; level < 100; level += 1) deep = { deep };
		expect(exceedsSize(deep, 1_000_000)).toBe(true);
	});
});
