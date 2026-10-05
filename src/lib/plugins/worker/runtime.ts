// The code that runs inside a plugin's Web Worker: waits for the host's `init` message, locks the
// worker's globals down, builds the `design` capability, loads the plugin's module and answers the
// host's requests. `bootstrap.ts` is the real entry; tests run this same function against an
// in-process scope, so the worker path is exercised without a browser.
//
// What the lockdown does and does not do: it removes the network, storage and worker-spawning
// globals so plugin code has no way to talk to the world except through `design`. A dynamic
// `import('https://...')` is not covered by deleting globals; the network allowlist of the
// permissions issue is the enforcement point for that (an Electron `webRequest` filter).

import { SDK_API_VERSION, createDesign, type SdkEnv } from './design';
import { EventHub } from './events';
import { createFigmaCompat, type FigmaCompat } from './figma/figma';
import { RpcChannel, type RpcEndpoint, type RpcOptions } from '../rpc';

/** The slice of `DedicatedWorkerGlobalScope` the runtime uses. */
export interface WorkerScope {
	postMessage(message: unknown): void;
	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
	removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

/** Evaluates the plugin's source as a module with `design` available; resolves when it finished loading. */
export type ModuleLoader = (source: string, env: SdkEnv) => Promise<void>;

export interface InitMessage {
	t: 'init';
	pluginId: string;
	source: string;
	limits?: Pick<RpcOptions, 'maxMessageBytes' | 'maxInFlight' | 'maxIncoming' | 'timeoutMs'>;
}

/** Globals a plugin must not have: network, persistent storage, other workers. */
export const LOCKED_GLOBALS = [
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'importScripts',
	'indexedDB',
	'caches',
	'Worker',
	'SharedWorker',
	'BroadcastChannel',
	'WebTransport',
	'RTCPeerConnection'
] as const;

/** Replace the locked globals of `scope` with `undefined`, non-writable. Returns the names removed. */
export function lockdownGlobals(scope: object): string[] {
	const removed: string[] = [];
	for (const name of LOCKED_GLOBALS) {
		if (!(name in scope)) continue;
		try {
			Object.defineProperty(scope, name, {
				value: undefined,
				writable: false,
				configurable: false
			});
			removed.push(name);
		} catch {
			// A global the engine refuses to redefine stays; the network allowlist still applies.
		}
	}
	return removed;
}

function usesFigma(source: string): boolean {
	return /\bfigma\b/.test(source);
}

function isInitMessage(value: unknown): value is InitMessage {
	if (typeof value !== 'object' || value === null) return false;
	return Reflect.get(value, 't') === 'init' && typeof Reflect.get(value, 'source') === 'string';
}

function describeError(error: unknown): { message: string; stack?: string } {
	if (error instanceof Error) return { message: error.message, stack: error.stack };
	return { message: String(error) };
}

function endpointOf(scope: WorkerScope): RpcEndpoint {
	return {
		post: (message) => scope.postMessage(message),
		listen: (handler) => {
			const listener = (event: { data?: unknown }): void => handler(event.data);
			scope.addEventListener('message', listener);
			return () => scope.removeEventListener('message', listener);
		}
	};
}

/**
 * Start the runtime on `scope`. Returns a function that stops it (tests; a worker is simply
 * terminated by the host). The runtime sends `lifecycle.ready` after the module loaded, or
 * `lifecycle.error` with the reason.
 */
export function startPluginRuntime(scope: WorkerScope, loadModule: ModuleLoader): () => void {
	let channel: RpcChannel | null = null;
	const onInit = (event: { data?: unknown }): void => {
		if (channel !== null || !isInitMessage(event.data)) return;
		channel = boot(scope, event.data, loadModule);
	};
	scope.addEventListener('message', onInit);
	return () => {
		scope.removeEventListener('message', onInit);
		channel?.close('runtime stopped');
	};
}

function boot(scope: WorkerScope, init: InitMessage, loadModule: ModuleLoader): RpcChannel {
	const handlers = new Map<string, (params: unknown) => unknown>();
	const events = new EventHub({
		subscribe: (name) =>
			void channelRef.current?.request('events.subscribe', { name }).catch(() => {}),
		unsubscribe: (name) =>
			void channelRef.current?.request('events.unsubscribe', { name }).catch(() => {})
	});
	const channelRef: { current: RpcChannel | null } = { current: null };
	const reportError = (error: unknown): void => {
		const { message, stack } = describeError(error);
		channelRef.current?.emit('lifecycle.log', { level: 'error', message: stack ?? message });
	};
	const channel = new RpcChannel(endpointOf(scope), {
		...init.limits,
		handler: (method, params) => {
			const handler = handlers.get(method);
			if (handler === undefined) throw new Error(`the plugin has no handler for "${method}"`);
			return handler(params);
		},
		onEvent: (name, payload) => events.dispatch(name, payload, reportError)
	});
	channelRef.current = channel;

	const env: SdkEnv = {
		pluginId: init.pluginId,
		apiVersion: SDK_API_VERSION,
		call: (method, params) => channel.request(method, params),
		events,
		handle: (method, handler) => handlers.set(method, handler),
		reportError
	};
	lockdownGlobals(scope);
	const design = createDesign(env);
	Reflect.set(scope, 'design', design);
	// Only a plugin that mentions `figma` gets the Figma layer: it asks the host for a snapshot of
	// the page and opens a run, which a plugin written for `design` has no use for.
	let compat: FigmaCompat | null = null;
	if (usesFigma(init.source)) {
		const figmaCompat = createFigmaCompat(env, design);
		compat = figmaCompat;
		Reflect.set(scope, 'figma', figmaCompat.figma);
		env.fallbackCommand = () => figmaCompat.launchFromCommand(() => loadModule(init.source, env));
	}
	scope.addEventListener('unhandledrejection', (event) =>
		reportError(Reflect.get(event, 'reason'))
	);

	const startCompat = compat === null ? Promise.resolve() : compat.start();
	startCompat
		.then(() => loadModule(init.source, env))
		.then(
			() => {
				channel.emit('lifecycle.ready');
				compat?.finish().catch(reportError);
			},
			(error: unknown) => channel.emit('lifecycle.error', describeError(error))
		);
	return channel;
}
