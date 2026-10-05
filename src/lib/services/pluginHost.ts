// The `pluginHost` service: runs third-party plugins. Provided by plugin `plugin-host`.
//
// Each running plugin is a fiber (`plugin-worker:<id>`) hanging under the plugin's own stub fiber,
// and that fiber owns one Web Worker: its `apply` spawns the worker, connects the RPC channel and
// waits for the plugin's module to load; the effect inverses terminate the worker and close the
// channel. Unloading the plugin (or its stub fiber) therefore terminates the worker, and a worker
// that crashes or hangs takes down only its own fiber.
//
// Seams for the issues built on top:
//   registerApi(namespace, methods)   a namespace of the API the worker can call (`document.*`,
//                                     later `figma.*`, `storage.*`); each method may name the
//                                     permission it needs
//   registerRunScope(scope)           wraps every run (command, UI event) of a plugin, for example
//                                     in one history group
//   `plugins/permission` (serial)     asked before a method that names a permission runs; a string
//                                     answer refuses the call with that reason
//   broadcast(name, payload)          deliver a host event to every plugin that subscribed to it

import { Service, type Context, type Fiber, type Plugin } from '@neoworks/extension-system';
import {
	PluginConnection,
	type PluginRun,
	type RunScope,
	type WorkerFactory
} from '../plugins/connection';
import type { PluginManifest, PluginPermission } from '../plugins/manifest';
import { normalizeAllowedDomains } from '../plugins/network';
import { RegistrationBook } from '../plugins/registrations';
import type { PluginRecord, PluginRuntime } from '../plugins/types';
import type { PluginRegistryService } from './pluginRegistry';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginHost: PluginHostService;
	}
	interface Events {
		/** Dispatch mode: emit. A plugin's worker started and its module loaded. */
		'plugins/activated'(pluginId: string): void;
		/** Dispatch mode: emit. A plugin's worker stopped (unloaded or deactivated). */
		'plugins/deactivated'(pluginId: string): void;
		/** Dispatch mode: emit. A plugin failed to start, crashed or hung; `reason` says why. */
		'plugins/failed'(pluginId: string, reason: string): void;
		/**
		 * Dispatch mode: serial. A plugin calls an API method that needs `permission`. A listener
		 * refuses the call by answering with a reason; no answer lets it proceed. Call with
		 * `ctx.serial`.
		 */
		'plugins/permission'(
			request: PluginPermissionRequest
		): string | undefined | Promise<string | undefined>;
	}
}

export interface PluginPermissionRequest {
	pluginId: string;
	method: string;
	permission: PluginPermission;
}

/** What an API method is told about its caller. */
export interface ApiCall {
	pluginId: string;
	connection: PluginConnection;
	/** The run this call belongs to; `null` outside a command or UI event (a timer, an event handler). */
	run: PluginRun | null;
	/** The worker fiber's context: effects created on it are undone when the plugin unloads. */
	context: Context;
}

export type ApiHandler = (call: ApiCall, params: unknown) => unknown;

export interface ApiMethod {
	run: ApiHandler;
	/**
	 * Needed to call it: declared in the manifest and not refused by `plugins/permission`. A
	 * function decides from the parameters (`events.subscribe` depends on the event).
	 */
	permission?: PluginPermission | ((params: unknown) => PluginPermission | undefined);
}

export type ApiNamespace = Record<string, ApiMethod | ApiHandler>;

export class PluginRefusedError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = 'PluginRefusedError';
	}
}

/**
 * A call needed a permission the plugin lacks: it never declared it, or the user denied it. The
 * name crosses the RPC boundary, so a plugin can tell it from other failures
 * (`error.remoteName === 'PermissionDeniedError'`).
 */
export class PermissionDeniedError extends PluginRefusedError {
	constructor(
		readonly permission: PluginPermission,
		reason: string
	) {
		super(reason);
		this.name = 'PermissionDeniedError';
	}
}

export interface PluginHostLimits {
	/** Longest a request to or from a worker may wait for its answer. */
	requestTimeoutMs: number;
	/** Longest a plugin module may take to load. */
	startupTimeoutMs: number;
	/** Longest one run (command, UI event) may take before the plugin is considered hung. */
	runTimeoutMs: number;
	maxMessageBytes: number;
	/** Requests a worker may have in flight to the host; also what we send before queueing. */
	maxPendingRequests: number;
}

export interface PluginHostOptions {
	createWorker: WorkerFactory;
	limits: PluginHostLimits;
}

interface HostHolder {
	connections: Map<string, PluginConnection>;
	fibers: Map<string, Fiber>;
	activations: Map<string, Promise<PluginConnection>>;
	apis: Map<string, ApiNamespace>;
	runScopes: Set<RunScope>;
	eventPermissions: Map<string, PluginPermission>;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** The history label of a command run: its declared title, which names the plugin itself. */
function runLabel(pluginName: string, title: string | undefined, commandId: string): string {
	if (title === undefined) return `${pluginName}: ${commandId}`;
	return title;
}

function allowedDomainsOf(manifest: PluginManifest): string[] {
	if (!manifest.permissions.includes('network')) return [];
	if (manifest.networkAccess === undefined) return [];
	return normalizeAllowedDomains(manifest.networkAccess.allowedDomains);
}

function normalize(method: ApiMethod | ApiHandler): ApiMethod {
	if (typeof method === 'function') return { run: method };
	return method;
}

export class PluginHostService extends Service {
	// Shared mutable state in one object, see PluginRegistryService.
	private readonly holder: HostHolder = {
		connections: new Map(),
		fibers: new Map(),
		activations: new Map(),
		apis: new Map(),
		runScopes: new Set(),
		eventPermissions: new Map()
	};

	/** What `plugin-manifests`' stubs call; registered with the registry by the plugin. */
	readonly runtime: PluginRuntime;

	/** Run-time registrations by handle; every API namespace that registers things uses it. */
	readonly registrations = new RegistrationBook();

	/**
	 * `registry` is captured from the providing plugin's ctx (it injects `pluginRegistry`): a
	 * service called through another plugin's ctx must not need that plugin to inject it.
	 */
	constructor(
		ctx: Context,
		private readonly registry: PluginRegistryService,
		private readonly options: PluginHostOptions
	) {
		super(ctx, 'pluginHost');
		this.runtime = {
			activate: async (pluginId) => {
				await this.activate(pluginId);
			},
			runCommand: (pluginId, commandId, args) => this.runCommand(pluginId, commandId, args),
			call: async (pluginId, method, params) => {
				const connection = await this.activate(pluginId);
				return connection.request(method, params);
			},
			notify: (pluginId, method, params) => {
				this.activate(pluginId).then(
					(connection) => connection.channel.emit(method, params),
					(error: unknown) => this.ctx.logger.warn(describeError(error))
				);
			}
		};
	}

	// ---------- reads ----------

	connectionOf(pluginId: string): PluginConnection | undefined {
		return this.holder.connections.get(pluginId);
	}

	connections(): PluginConnection[] {
		return [...this.holder.connections.values()];
	}

	// ---------- the API seams ----------

	/** Offer `methods` to workers as `<namespace>.<method>`; the disposer removes this namespace only. */
	registerApi(namespace: string, methods: ApiNamespace): () => void {
		this.holder.apis.set(namespace, methods);
		return () => {
			if (this.holder.apis.get(namespace) === methods) this.holder.apis.delete(namespace);
		};
	}

	registerRunScope(scope: RunScope): () => void {
		this.holder.runScopes.add(scope);
		return () => {
			this.holder.runScopes.delete(scope);
		};
	}

	/**
	 * Name the permission needed to subscribe to each of `events` (`selectionchange` needs
	 * `selection`); events not named here are open to every plugin. The disposer removes these.
	 */
	registerEventPermissions(events: Record<string, PluginPermission>): () => void {
		for (const [name, permission] of Object.entries(events)) {
			this.holder.eventPermissions.set(name, permission);
		}
		return () => {
			for (const [name, permission] of Object.entries(events)) {
				if (this.holder.eventPermissions.get(name) === permission) {
					this.holder.eventPermissions.delete(name);
				}
			}
		};
	}

	/** The permission subscribing to `eventName` needs, if any. */
	eventPermission(eventName: string): PluginPermission | undefined {
		return this.holder.eventPermissions.get(eventName);
	}

	/** Send a host event to every running plugin that subscribed to it. */
	broadcast(name: string, payload: unknown): void {
		for (const connection of this.holder.connections.values()) connection.deliver(name, payload);
	}

	// ---------- lifecycle ----------

	/**
	 * Start the plugin's worker unless it runs. Concurrent calls share one start. A plugin that
	 * failed stays failed until `restart`, and says why.
	 */
	activate(pluginId: string): Promise<PluginConnection> {
		const running = this.holder.connections.get(pluginId);
		if (running !== undefined) return Promise.resolve(running);
		const starting = this.holder.activations.get(pluginId);
		if (starting !== undefined) return starting;
		const record = this.registry.get(pluginId);
		if (record === undefined || record.manifest === null) {
			return Promise.reject(new Error(`no plugin "${pluginId}" is loaded`));
		}
		if (record.status === 'failed') {
			return Promise.reject(new Error(`plugin "${pluginId}" failed: ${record.error ?? 'unknown'}`));
		}
		const started = this.start(record).finally(() => this.holder.activations.delete(pluginId));
		this.holder.activations.set(pluginId, started);
		return started;
	}

	/** Stop the plugin's worker; its registrations go with it, its document changes stay. */
	async deactivate(pluginId: string): Promise<void> {
		const fiber = this.holder.fibers.get(pluginId);
		if (fiber === undefined) return;
		this.holder.fibers.delete(pluginId);
		await fiber.dispose();
		this.registry.setStatus(pluginId, 'inactive');
		this.ctx.emit('plugins/deactivated', pluginId);
	}

	/** Hot restart: unload the worker and its registrations and start the plugin again. */
	async restart(pluginId: string): Promise<PluginConnection> {
		await this.deactivate(pluginId);
		this.registry.setStatus(pluginId, 'inactive');
		return this.activate(pluginId);
	}

	/** Stop every running plugin (the host is unloading): workers terminate, nothing leaks. */
	async shutdown(): Promise<void> {
		const ids = [...this.holder.fibers.keys()];
		await Promise.all(ids.map((pluginId) => this.deactivate(pluginId)));
	}

	/** The worker is unusable: terminate it and mark the plugin failed. Others are unaffected. */
	fail(pluginId: string, reason: string): void {
		const fiber = this.holder.fibers.get(pluginId);
		this.holder.fibers.delete(pluginId);
		this.registry.setStatus(pluginId, 'failed', reason);
		this.ctx.emit('plugins/failed', pluginId, reason);
		if (fiber !== undefined)
			fiber.dispose().catch((error: unknown) => this.ctx.logger.error(error));
	}

	private async start(record: PluginRecord): Promise<PluginConnection> {
		const pluginId = record.id;
		const parent = this.registry.fiberContextOf(pluginId);
		if (parent === undefined) throw new Error(`plugin "${pluginId}" is not mounted`);
		const fiber = parent.plugin(this.workerPlugin(record));
		this.holder.fibers.set(pluginId, fiber);
		try {
			await fiber;
		} catch (error) {
			const reason = describeError(error);
			this.holder.fibers.delete(pluginId);
			this.registry.setStatus(pluginId, 'failed', reason);
			this.ctx.emit('plugins/failed', pluginId, reason);
			throw new Error(`plugin "${pluginId}" failed to start: ${reason}`, { cause: error });
		}
		const connection = this.holder.connections.get(pluginId);
		if (connection === undefined) throw new Error(`plugin "${pluginId}" stopped while starting`);
		this.registry.setStatus(pluginId, 'active');
		this.ctx.emit('plugins/activated', pluginId);
		return connection;
	}

	/** The fiber that owns one plugin's worker. */
	private workerPlugin(record: PluginRecord): Plugin.Object {
		const { limits, createWorker } = this.options;
		const manifest = record.manifest;
		if (manifest === null) throw new Error(`plugin "${record.id}" has no manifest`);
		const rpcLimits = {
			maxMessageBytes: limits.maxMessageBytes,
			maxInFlight: limits.maxPendingRequests,
			maxIncoming: limits.maxPendingRequests * 2,
			timeoutMs: limits.requestTimeoutMs
		};
		const apply = async (ctx: Context): Promise<void> => {
			const worker = createWorker(record.id, { allowedDomains: allowedDomainsOf(manifest) });
			ctx.effect(() => () => worker.terminate(), `plugin ${record.id} worker`);
			const connection = new PluginConnection({
				pluginId: record.id,
				manifest,
				context: ctx,
				worker,
				limits: rpcLimits,
				runTimeoutMs: limits.runTimeoutMs,
				dispatch: (caller, method, params) => this.dispatch(caller, method, params),
				runScopes: () => [...this.holder.runScopes],
				onFatal: (caller, reason) => this.fail(caller.pluginId, reason)
			});
			ctx.effect(() => {
				this.holder.connections.set(record.id, connection);
				const onError = (event: { message?: string }): void =>
					connection.reportWorkerError(event.message ?? 'the worker raised an error');
				worker.addEventListener('error', onError);
				worker.addEventListener('messageerror', onError);
				return () => {
					worker.removeEventListener('error', onError);
					worker.removeEventListener('messageerror', onError);
					connection.dispose('plugin unloaded');
					if (this.holder.connections.get(record.id) === connection) {
						this.holder.connections.delete(record.id);
					}
				};
			}, `plugin ${record.id} connection`);

			const source = await ctx.desktop.pluginsReadFile(
				record.source,
				record.directoryName,
				manifest.main
			);
			worker.postMessage({
				t: 'init',
				pluginId: record.id,
				source,
				limits: rpcLimits
			});
			await connection.whenReady(limits.startupTimeoutMs);
		};
		return { name: `plugin-worker:${record.id}`, inject: ['desktop'], apply };
	}

	// ---------- running commands ----------

	private async runCommand(pluginId: string, commandId: string, args: unknown): Promise<void> {
		const connection = await this.activate(pluginId);
		const title = connection.manifest.contributes.commands.find(
			(command) => command.id === commandId
		)?.title;
		const label = runLabel(connection.manifest.name, title, commandId);
		await connection.runScoped(label, 'command', () =>
			connection.request('command.run', { id: commandId, args })
		);
	}

	// ---------- API dispatch ----------

	private async dispatch(
		connection: PluginConnection,
		method: string,
		params: unknown
	): Promise<unknown> {
		const separator = method.indexOf('.');
		const namespace = method.slice(0, separator);
		const name = method.slice(separator + 1);
		const methods = this.holder.apis.get(namespace);
		if (separator < 0 || methods === undefined || !Object.hasOwn(methods, name)) {
			throw new Error(`unknown API method "${method}"`);
		}
		const api = normalize(methods[name]);
		const permission = this.permissionFor(api, params);
		if (permission !== undefined) await this.requirePermission(connection, method, permission);
		return api.run(
			{
				pluginId: connection.pluginId,
				connection,
				run: connection.currentRun,
				context: connection.context
			},
			params
		);
	}

	private permissionFor(api: ApiMethod, params: unknown): PluginPermission | undefined {
		if (typeof api.permission === 'function') return api.permission(params);
		return api.permission;
	}

	private async requirePermission(
		connection: PluginConnection,
		method: string,
		permission: PluginPermission
	): Promise<void> {
		if (!connection.manifest.permissions.includes(permission)) {
			throw new PermissionDeniedError(
				permission,
				`plugin "${connection.pluginId}" did not declare the "${permission}" permission needed by ${method}`
			);
		}
		const refusal = await this.ctx.serial('plugins/permission', {
			pluginId: connection.pluginId,
			method,
			permission
		});
		if (typeof refusal === 'string') throw new PermissionDeniedError(permission, refusal);
	}

	snapshotState(): Record<string, unknown> {
		return {
			running: [...this.holder.connections.keys()].sort(),
			apis: [...this.holder.apis.keys()].sort(),
			runScopes: this.holder.runScopes.size,
			eventPermissions: [...this.holder.eventPermissions.keys()].sort()
		};
	}
}
