// The `design` object a plugin sees in its worker: the one capability it is handed. Everything on
// it is a thin wrapper over a host RPC call (`env.call('document.getNode', ...)`); the plugin gets
// no DOM, no Node and, after `lockdownGlobals`, no network or storage globals of its own.
//
// The surface is assembled in `createDesign` from one factory per namespace (core here; document,
// selection, commands, ... in the plugin API issue), each taking only the `SdkEnv`, so a namespace
// never reaches into another's state. Everything that crosses the boundary is plain data.

import { EventHub, type EventListener } from './events';

export const SDK_API_VERSION = '1.0';

export type LogLevel = 'info' | 'warn' | 'error';

/** What every module of the SDK is given. */
export interface SdkEnv {
	pluginId: string;
	apiVersion: string;
	/** Call a host API method (`namespace.method`) and await its answer. */
	call(method: string, params?: unknown): Promise<unknown>;
	events: EventHub;
	/** Answer requests the host sends (`command.run`, `ui.event`, ...); one handler per method. */
	handle(method: string, handler: (params: unknown) => unknown): void;
	/** Report an error of the plugin's own code to the host's plugin console. */
	reportError(error: unknown): void;
}

export interface LogApi {
	info(...parts: unknown[]): void;
	warn(...parts: unknown[]): void;
	error(...parts: unknown[]): void;
}

export interface CoreApi {
	readonly pluginId: string;
	/** The plugin API version this app provides. */
	readonly apiVersion: string;
	/** Subscribe to a host event (`selectionchange`, `documentchange`, ...). */
	on(name: string, listener: EventListener): void;
	off(name: string, listener: EventListener): void;
	once(name: string, listener: EventListener): void;
	readonly log: LogApi;
}

/** The whole surface; namespaces of later modules are added to this interface. */
export type DesignApi = CoreApi;

function formatPart(part: unknown): string {
	if (typeof part === 'string') return part;
	if (part instanceof Error) return part.stack === undefined ? part.message : part.stack;
	try {
		return JSON.stringify(part);
	} catch {
		return String(part);
	}
}

function createCore(env: SdkEnv): CoreApi {
	const write = (level: LogLevel, parts: unknown[]): void => {
		env.call('log.write', { level, message: parts.map(formatPart).join(' ') }).catch(() => {});
	};
	return {
		pluginId: env.pluginId,
		apiVersion: env.apiVersion,
		on: (name, listener) => env.events.on(name, listener),
		off: (name, listener) => env.events.off(name, listener),
		once: (name, listener) => env.events.once(name, listener),
		log: {
			info: (...parts) => write('info', parts),
			warn: (...parts) => write('warn', parts),
			error: (...parts) => write('error', parts)
		}
	};
}

export function createDesign(env: SdkEnv): DesignApi {
	return Object.freeze({ ...createCore(env) });
}
