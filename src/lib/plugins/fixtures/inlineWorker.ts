// An in-process stand-in for a Web Worker: the real worker runtime (`startPluginRuntime`) runs
// against a scope that is wired to the host through two in-memory pipes, so tests exercise the
// actual protocol, lockdown and SDK without a browser. Messages are structured-cloned like in a
// real worker and delivered asynchronously.

import type { WorkerEventLike, WorkerFactory, WorkerLike } from '../connection';
import { startPluginRuntime, type WorkerScope } from '../worker/runtime';

type Listener = (event: WorkerEventLike) => void;

class Pipe {
	readonly listeners = new Map<string, Set<Listener>>();

	add(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	remove(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}

	fire(type: string, event: WorkerEventLike): void {
		for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
	}

	count(): number {
		let total = 0;
		for (const set of this.listeners.values()) total += set.size;
		return total;
	}
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...parts: string[]
) => (...args: unknown[]) => Promise<unknown>;

export class InlineWorker implements WorkerLike {
	terminated = false;
	/** The worker's global object: tests read `scope.design` and what lockdown did to it. */
	readonly scope: WorkerScope & Record<string, unknown>;
	private readonly toHost = new Pipe();
	private readonly toWorker = new Pipe();
	private readonly stopRuntime: () => void;

	constructor(globals: Record<string, unknown> = {}) {
		const scope: WorkerScope & Record<string, unknown> = {
			...globals,
			postMessage: (message) => this.deliver(this.toHost, message),
			addEventListener: (type, listener) => this.toWorker.add(type, listener),
			removeEventListener: (type, listener) => this.toWorker.remove(type, listener)
		};
		this.scope = scope;
		// The source is a function body with `design` and `hostCall` (a raw host API call, which the
		// real SDK wraps per namespace) in scope; the real worker loads it as an ES module instead.
		this.stopRuntime = startPluginRuntime(scope, async (source, env) => {
			const run = new AsyncFunction('design', 'hostCall', source);
			await run(scope.design, (method: string, params?: unknown) => env.call(method, params));
		});
	}

	private deliver(pipe: Pipe, message: unknown): void {
		if (this.terminated) return;
		const copy = structuredClone(message);
		queueMicrotask(() => {
			if (!this.terminated) pipe.fire('message', { data: copy });
		});
	}

	postMessage(message: unknown): void {
		this.deliver(this.toWorker, message);
	}

	terminate(): void {
		this.terminated = true;
		this.stopRuntime();
	}

	addEventListener(type: string, listener: Listener): void {
		this.toHost.add(type, listener);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.toHost.remove(type, listener);
	}

	/** Listeners the host still has on this worker; 0 once the connection was torn down. */
	hostListenerCount(): number {
		return this.toHost.count();
	}

	/** Test driver: the worker raised an uncaught error. */
	crash(message: string): void {
		this.toHost.fire('error', { message });
	}
}

export interface InlineWorkers {
	factory: WorkerFactory;
	/** Every worker created, oldest first, by plugin id. */
	created: { pluginId: string; worker: InlineWorker }[];
	/** The latest worker of a plugin. */
	of(pluginId: string): InlineWorker;
	alive(): string[];
}

export function inlineWorkers(globals: Record<string, unknown> = {}): InlineWorkers {
	const created: { pluginId: string; worker: InlineWorker }[] = [];
	return {
		created,
		factory: (pluginId) => {
			const worker = new InlineWorker(globals);
			created.push({ pluginId, worker });
			return worker;
		},
		of: (pluginId) => {
			const entry = created.filter((candidate) => candidate.pluginId === pluginId).at(-1);
			if (entry === undefined) throw new Error(`no worker was created for ${pluginId}`);
			return entry.worker;
		},
		alive: () => created.filter((entry) => !entry.worker.terminated).map((entry) => entry.pluginId)
	};
}
