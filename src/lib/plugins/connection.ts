// The host's end of one running plugin: its Web Worker, the RPC channel to it, the events it
// subscribed to, its plugin console and the run (command, UI event) it is executing.
//
// A connection is created by the worker fiber's `apply` and disposed by an effect inverse, so it
// lives exactly as long as the worker does. It holds no kernel services: the plugin host passes
// in what it needs as callbacks.

import type { Context } from '@neoworks/extension-system';
import { RpcChannel, type RpcEndpoint, type RpcMessage, type RpcOptions } from './rpc';
import type { PluginManifest } from './manifest';

/** The slice of `Worker` the host uses; tests pass an in-process double. */
export interface WorkerLike {
	postMessage(message: unknown): void;
	terminate(): void;
	addEventListener(type: string, listener: (event: WorkerEventLike) => void): void;
	removeEventListener(type: string, listener: (event: WorkerEventLike) => void): void;
}

export interface WorkerEventLike {
	data?: unknown;
	message?: string;
}

export type WorkerFactory = (pluginId: string) => WorkerLike;

/** A stretch of plugin work that is one undo step: a command, a UI event. */
export interface PluginRun {
	id: string;
	pluginId: string;
	label: string;
	kind: 'command' | 'ui' | 'event';
}

/** Wraps a run, for example in a history group; scopes nest in registration order. */
export type RunScope = (run: PluginRun, body: () => Promise<unknown>) => Promise<unknown>;

export interface PluginLogLine {
	level: 'info' | 'warn' | 'error';
	message: string;
	at: number;
}

export interface ConnectionOptions {
	pluginId: string;
	manifest: PluginManifest;
	/** The worker fiber's context: registrations a plugin makes attach to it and die with the worker. */
	context: Context;
	worker: WorkerLike;
	limits: Pick<RpcOptions, 'maxMessageBytes' | 'maxInFlight' | 'maxIncoming' | 'timeoutMs'>;
	runTimeoutMs: number;
	/** Answers the worker's API requests (`namespace.method`). */
	dispatch(connection: PluginConnection, method: string, params: unknown): unknown;
	runScopes(): readonly RunScope[];
	/** The worker is unusable (a run timed out): the host marks the plugin failed. */
	onFatal(connection: PluginConnection, reason: string): void;
}

const MAX_LOG_LINES = 500;

export class PluginRunTimeoutError extends Error {
	constructor(label: string, timeoutMs: number) {
		super(`"${label}" did not finish within ${timeoutMs} ms`);
		this.name = 'PluginRunTimeoutError';
	}
}

function endpointOf(worker: WorkerLike): RpcEndpoint {
	return {
		post: (message: RpcMessage) => worker.postMessage(message),
		listen: (handler) => {
			const listener = (event: WorkerEventLike): void => handler(event.data);
			worker.addEventListener('message', listener);
			return () => worker.removeEventListener('message', listener);
		}
	};
}

function asError(value: unknown): Error {
	if (value instanceof Error) return value;
	return new Error(String(value));
}

function readString(value: unknown, key: string): string {
	if (typeof value !== 'object' || value === null) return '';
	const field: unknown = Reflect.get(value, key);
	if (typeof field === 'string') return field;
	return '';
}

export class PluginConnection {
	readonly pluginId: string;
	readonly manifest: PluginManifest;
	readonly context: Context;
	readonly channel: RpcChannel;
	/** Event names the plugin asked for; the host only sends these. */
	readonly subscriptions = new Set<string>();
	/** The plugin console: what it logged and the errors of its own code. */
	readonly logs: PluginLogLine[] = [];
	/** The run being executed now; API calls made during it belong to it. */
	currentRun: PluginRun | null = null;

	private tail: Promise<unknown> = Promise.resolve();
	private runCounter = 0;
	private readonly readyWaiters: { resolve(): void; reject(error: Error): void }[] = [];
	private readyState: 'waiting' | 'ready' | Error = 'waiting';

	constructor(private readonly options: ConnectionOptions) {
		this.pluginId = options.pluginId;
		this.manifest = options.manifest;
		this.context = options.context;
		this.channel = new RpcChannel(endpointOf(options.worker), {
			...options.limits,
			handler: (method, params) => options.dispatch(this, method, params),
			onEvent: (name, payload) => this.receiveEvent(name, payload)
		});
	}

	get isReady(): boolean {
		return this.readyState === 'ready';
	}

	/** Resolves when the plugin's module finished loading; rejects when it threw or took too long. */
	whenReady(timeoutMs: number): Promise<void> {
		if (this.readyState === 'ready') return Promise.resolve();
		if (this.readyState instanceof Error) return Promise.reject(this.readyState);
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				const error = new Error(`did not finish loading within ${timeoutMs} ms`);
				this.failStartup(error);
			}, timeoutMs);
			this.readyWaiters.push({
				resolve: () => {
					clearTimeout(timer);
					resolve();
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				}
			});
		});
	}

	/** A worker error event: fatal while loading, otherwise a line in the plugin console. */
	reportWorkerError(message: string): void {
		this.addLog('error', message);
		if (this.readyState === 'waiting') this.failStartup(new Error(message));
	}

	private receiveEvent(name: string, payload: unknown): void {
		if (name === 'lifecycle.ready') this.markReady();
		else if (name === 'lifecycle.error') {
			this.addLog('error', readString(payload, 'message'));
			this.failStartup(new Error(readString(payload, 'message')));
		} else if (name === 'lifecycle.log') {
			this.addLog('error', readString(payload, 'message'));
		}
	}

	private markReady(): void {
		if (this.readyState !== 'waiting') return;
		this.readyState = 'ready';
		for (const waiter of this.readyWaiters.splice(0)) waiter.resolve();
	}

	private failStartup(error: Error): void {
		if (this.readyState !== 'waiting') return;
		this.readyState = error;
		for (const waiter of this.readyWaiters.splice(0)) waiter.reject(error);
	}

	addLog(level: PluginLogLine['level'], message: string): void {
		this.logs.push({ level, message, at: Date.now() });
		if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
	}

	/** Send a host event to the plugin when it subscribed to `name`. */
	deliver(name: string, payload: unknown): void {
		if (this.subscriptions.has(name)) this.channel.emit(name, payload);
	}

	request(method: string, params?: unknown): Promise<unknown> {
		return this.channel.request(method, params);
	}

	/**
	 * Execute `body` as one run: after earlier runs of this plugin finished, inside the registered
	 * run scopes (the plugin API wraps it in one history group), with `currentRun` set so the API
	 * calls the plugin makes belong to it. A run that outlives `runTimeoutMs` fails the plugin.
	 */
	runScoped(
		label: string,
		kind: PluginRun['kind'],
		body: () => Promise<unknown>
	): Promise<unknown> {
		const result = this.tail.then(() => this.execute(label, kind, body));
		this.tail = result.catch(() => undefined);
		return result;
	}

	private async execute(
		label: string,
		kind: PluginRun['kind'],
		body: () => Promise<unknown>
	): Promise<unknown> {
		this.runCounter += 1;
		const run: PluginRun = {
			id: `${this.pluginId}:${this.runCounter}:${Date.now().toString(36)}`,
			pluginId: this.pluginId,
			label,
			kind
		};
		let wrapped = body;
		for (const scope of [...this.options.runScopes()].reverse()) {
			const inner = wrapped;
			wrapped = () => scope(run, inner);
		}
		this.currentRun = run;
		try {
			return await this.withTimeout(label, wrapped());
		} finally {
			this.currentRun = null;
		}
	}

	private withTimeout(label: string, work: Promise<unknown>): Promise<unknown> {
		const timeoutMs = this.options.runTimeoutMs;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				const error = new PluginRunTimeoutError(label, timeoutMs);
				this.options.onFatal(this, error.message);
				reject(error);
			}, timeoutMs);
			work.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error: unknown) => {
					clearTimeout(timer);
					reject(asError(error));
				}
			);
		});
	}

	/** Stop talking to the worker and fail everything outstanding. */
	dispose(reason: string): void {
		this.channel.close(reason);
		this.failStartup(new Error(reason));
	}
}
