// Typed-enough RPC between the host and a plugin's worker, over anything that can post structured
// clones (a Worker, a MessagePort, a test double). Pure: no kernel, no DOM, runs on both sides.
//
//   request / response   `channel.request('document.getNode', { id })` resolves with the answer or
//                        rejects with an `RpcError` carrying the other side's error name and message
//   events               `channel.emit('selectionchange', payload)`, fire and forget
//
// Limits (a plugin is untrusted code and may be buggy):
//   - a message bigger than `maxMessageBytes` is refused before it is sent, and a request from the
//     other side that is bigger is answered with an error instead of being handled
//   - at most `maxInFlight` of our requests are on the wire; further ones wait in a queue (backpressure)
//   - at most `maxIncoming` requests of the other side are handled at once; more are refused
//   - a request that gets no answer within `timeoutMs` rejects with a timeout error

export type RpcMessage =
	| { t: 'req'; id: number; method: string; params: unknown }
	| { t: 'res'; id: number; ok: true; value: unknown }
	| { t: 'res'; id: number; ok: false; error: { name: string; message: string } }
	| { t: 'evt'; name: string; payload: unknown };

/** One end of a connection. `listen` returns the function that stops listening. */
export interface RpcEndpoint {
	post(message: RpcMessage): void;
	listen(handler: (message: unknown) => void): () => void;
}

export interface RpcOptions {
	/** Answers requests of the other side. */
	handler: (method: string, params: unknown) => unknown;
	/** Receives events of the other side. */
	onEvent?: (name: string, payload: unknown) => void;
	maxMessageBytes?: number;
	maxInFlight?: number;
	maxIncoming?: number;
	timeoutMs?: number;
}

export const DEFAULT_RPC_LIMITS = {
	maxMessageBytes: 8 * 1024 * 1024,
	maxInFlight: 64,
	maxIncoming: 128,
	timeoutMs: 30_000
};

export class RpcError extends Error {
	constructor(
		readonly remoteName: string,
		message: string
	) {
		super(message);
		this.name = 'RpcError';
	}
}

export class RpcClosedError extends Error {
	constructor(reason: string) {
		super(`connection closed: ${reason}`);
		this.name = 'RpcClosedError';
	}
}

export class RpcTimeoutError extends Error {
	constructor(method: string, timeoutMs: number) {
		super(`"${method}" got no answer within ${timeoutMs} ms`);
		this.name = 'RpcTimeoutError';
	}
}

const MAX_DEPTH = 64;

/**
 * Whether the structured-clone size of `value` exceeds `limit` bytes, counted roughly (strings by
 * length, binary data by byte length, other primitives as 8). Stops counting as soon as the limit
 * is passed, so a huge value costs no more than the limit to refuse.
 */
export function exceedsSize(value: unknown, limit: number): boolean {
	let total = 0;
	const seen = new Set<object>();
	const visit = (item: unknown, depth: number): boolean => {
		if (total > limit) return true;
		if (depth > MAX_DEPTH) return true;
		if (typeof item === 'string') {
			total += item.length;
			return total > limit;
		}
		if (typeof item !== 'object' || item === null) {
			total += 8;
			return total > limit;
		}
		if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
			total += item.byteLength;
			return total > limit;
		}
		if (seen.has(item)) return false;
		seen.add(item);
		for (const key of Object.keys(item)) {
			total += key.length;
			if (visit(Reflect.get(item, key), depth + 1)) return true;
		}
		return total > limit;
	};
	return visit(value, 0);
}

function describeError(error: unknown): { name: string; message: string } {
	if (error instanceof Error) return { name: error.name, message: error.message };
	return { name: 'Error', message: String(error) };
}

function isMessage(value: unknown): value is RpcMessage {
	if (typeof value !== 'object' || value === null) return false;
	const kind: unknown = Reflect.get(value, 't');
	return kind === 'req' || kind === 'res' || kind === 'evt';
}

interface Pending {
	method: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface Queued {
	method: string;
	params: unknown;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

export class RpcChannel {
	private readonly pending = new Map<number, Pending>();
	private readonly queue: Queued[] = [];
	private readonly stopListening: () => void;
	private nextId = 1;
	private incoming = 0;
	private closedReason: string | null = null;
	private readonly limits: typeof DEFAULT_RPC_LIMITS;

	constructor(
		private readonly endpoint: RpcEndpoint,
		private readonly options: RpcOptions
	) {
		this.limits = {
			maxMessageBytes: options.maxMessageBytes ?? DEFAULT_RPC_LIMITS.maxMessageBytes,
			maxInFlight: options.maxInFlight ?? DEFAULT_RPC_LIMITS.maxInFlight,
			maxIncoming: options.maxIncoming ?? DEFAULT_RPC_LIMITS.maxIncoming,
			timeoutMs: options.timeoutMs ?? DEFAULT_RPC_LIMITS.timeoutMs
		};
		this.stopListening = endpoint.listen((message) => this.receive(message));
	}

	get isClosed(): boolean {
		return this.closedReason !== null;
	}

	/** Requests on the wire plus queued ones, for tests and the plugin manager. */
	get outstanding(): number {
		return this.pending.size + this.queue.length;
	}

	request<Result = unknown>(method: string, params?: unknown): Promise<Result> {
		if (this.closedReason !== null) return Promise.reject(new RpcClosedError(this.closedReason));
		if (exceedsSize(params, this.limits.maxMessageBytes)) {
			return Promise.reject(
				new RpcError(
					'RangeError',
					`"${method}" is larger than ${this.limits.maxMessageBytes} bytes`
				)
			);
		}
		return new Promise<Result>((resolve, reject) => {
			this.queue.push({ method, params, resolve: (value) => resolve(value as Result), reject });
			this.drain();
		});
	}

	emit(name: string, payload?: unknown): void {
		if (this.closedReason !== null) return;
		if (exceedsSize(payload, this.limits.maxMessageBytes)) return;
		this.endpoint.post({ t: 'evt', name, payload });
	}

	/** Stop listening and reject everything outstanding. Idempotent. */
	close(reason: string): void {
		if (this.closedReason !== null) return;
		this.closedReason = reason;
		this.stopListening();
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new RpcClosedError(reason));
		}
		this.pending.clear();
		for (const entry of this.queue.splice(0)) entry.reject(new RpcClosedError(reason));
	}

	private drain(): void {
		while (this.queue.length > 0 && this.pending.size < this.limits.maxInFlight) {
			const next = this.queue.shift();
			if (next !== undefined) this.send(next);
		}
	}

	private send(entry: Queued): void {
		const id = this.nextId;
		this.nextId += 1;
		const timer = setTimeout(() => {
			this.pending.delete(id);
			entry.reject(new RpcTimeoutError(entry.method, this.limits.timeoutMs));
			this.drain();
		}, this.limits.timeoutMs);
		this.pending.set(id, { ...entry, timer });
		this.endpoint.post({ t: 'req', id, method: entry.method, params: entry.params });
	}

	private receive(message: unknown): void {
		if (this.closedReason !== null || !isMessage(message)) return;
		if (message.t === 'res') this.receiveResponse(message);
		else if (message.t === 'evt') this.options.onEvent?.(message.name, message.payload);
		else void this.receiveRequest(message.id, message.method, message.params);
	}

	private receiveResponse(message: Extract<RpcMessage, { t: 'res' }>): void {
		const entry = this.pending.get(message.id);
		if (entry === undefined) return;
		this.pending.delete(message.id);
		clearTimeout(entry.timer);
		if (message.ok) entry.resolve(message.value);
		else entry.reject(new RpcError(message.error.name, message.error.message));
		this.drain();
	}

	private async receiveRequest(id: number, method: string, params: unknown): Promise<void> {
		if (this.incoming >= this.limits.maxIncoming) {
			this.respondError(id, new RpcError('RangeError', 'too many requests at once'));
			return;
		}
		if (exceedsSize(params, this.limits.maxMessageBytes)) {
			this.respondError(id, new RpcError('RangeError', `"${method}" is too large`));
			return;
		}
		this.incoming += 1;
		try {
			const value = await this.options.handler(method, params);
			if (exceedsSize(value, this.limits.maxMessageBytes)) {
				throw new RpcError('RangeError', `the answer to "${method}" is too large`);
			}
			if (this.closedReason === null) this.endpoint.post({ t: 'res', id, ok: true, value });
		} catch (error) {
			this.respondError(id, error);
		} finally {
			this.incoming -= 1;
		}
	}

	private respondError(id: number, error: unknown): void {
		if (this.closedReason !== null) return;
		const described = describeError(error);
		this.endpoint.post({ t: 'res', id, ok: false, error: described });
	}
}
