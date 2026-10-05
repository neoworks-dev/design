import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import type { WorkerFactory, WorkerOptions } from '../../lib/plugins/connection';
import { WORKER_HOSTS_PARAMETER, WORKER_MARKER_PARAMETER } from '../../lib/plugins/network';
import bootstrapUrl from '../../lib/plugins/worker/bootstrap.ts?worker&url';
import { PluginHostService } from '../../lib/services/pluginHost';

const pluginHostConfigSchema = z
	.object({
		requestTimeoutMs: z
			.number()
			.int()
			.positive()
			.default(30_000)
			.describe('Longest a request between the app and a plugin may wait for its answer.'),
		startupTimeoutMs: z
			.number()
			.int()
			.positive()
			.default(10_000)
			.describe('Longest a plugin may take to load before it counts as failed.'),
		runTimeoutMs: z
			.number()
			.int()
			.positive()
			.default(30_000)
			.describe('Longest one plugin command or UI event may run before the plugin counts as hung.'),
		maxMessageBytes: z
			.number()
			.int()
			.positive()
			.default(8 * 1024 * 1024)
			.describe('Largest message accepted from or sent to a plugin.'),
		maxPendingRequests: z
			.number()
			.int()
			.positive()
			.default(64)
			.describe('Requests a plugin may have in flight at once.'),
		/** Tests replace the worker with an in-process double. Not a setting. */
		createWorker: z.unknown().optional()
	})
	.prefault({});
type PluginHostConfig = z.infer<typeof pluginHostConfigSchema>;

function isWorkerFactory(value: unknown): value is WorkerFactory {
	return typeof value === 'function';
}

// The script URL carries the network allowlist: main's protocol handler turns it into the worker's
// Content-Security-Policy, which is what stops `import('https://...')` (see network.ts).
function moduleWorker(pluginId: string, options: WorkerOptions): ReturnType<WorkerFactory> {
	const url = new URL(bootstrapUrl, location.href);
	url.searchParams.set(WORKER_MARKER_PARAMETER, '1');
	url.searchParams.set(WORKER_HOSTS_PARAMETER, options.allowedDomains.join(','));
	return new Worker(url, { type: 'module', name: `plugin:${pluginId}` });
}

// Third-party plugins, part three (#155): provides `pluginHost`, which runs each plugin in its own
// Web Worker behind one fiber. The stubs of `plugin-manifests` activate it on first use; a worker
// that crashes, hangs or fails to load marks only its own plugin failed. The API a worker can call
// is registered on the host (`pluginHost.registerApi`), the core namespaces `events` and `log` here.
export default {
	name: 'plugin-host',
	inject: ['pluginRegistry', 'desktop'],
	Config: pluginHostConfigSchema,
	apply(ctx: Context, config: PluginHostConfig): void {
		const createWorker = isWorkerFactory(config.createWorker) ? config.createWorker : moduleWorker;
		const host = new PluginHostService(ctx, ctx.pluginRegistry, {
			createWorker,
			limits: {
				requestTimeoutMs: config.requestTimeoutMs,
				startupTimeoutMs: config.startupTimeoutMs,
				runTimeoutMs: config.runTimeoutMs,
				maxMessageBytes: config.maxMessageBytes,
				maxPendingRequests: config.maxPendingRequests
			}
		});

		ctx.effect(() => ctx.pluginRegistry.setRuntime(host.runtime), 'plugin-host runtime');
		ctx.effect(() => () => host.shutdown(), 'plugin-host stop workers');

		ctx.effect(
			() =>
				host.registerApi('events', {
					subscribe: {
						permission: (params) => host.eventPermission(readName(params)),
						run: (call, params) => {
							call.connection.subscriptions.add(readName(params));
						}
					},
					unsubscribe: (call, params) => {
						call.connection.subscriptions.delete(readName(params));
					}
				}),
			'plugin api events'
		);
		ctx.effect(
			() =>
				host.registerApi('registrations', {
					release: (call, params) => {
						host.registrations.release(call.connection, readHandle(params));
					}
				}),
			'plugin api registrations'
		);
		ctx.effect(
			() =>
				host.registerApi('log', {
					write: (call, params) => {
						call.connection.addLog(readLevel(params), readMessage(params));
					}
				}),
			'plugin api log'
		);
	}
};

function readName(params: unknown): string {
	if (typeof params === 'object' && params !== null) {
		const name: unknown = Reflect.get(params, 'name');
		if (typeof name === 'string' && name.length > 0) return name;
	}
	throw new Error('an event name is required');
}

function readHandle(params: unknown): number {
	if (typeof params === 'object' && params !== null) {
		const handle: unknown = Reflect.get(params, 'handle');
		if (typeof handle === 'number') return handle;
	}
	throw new Error('a registration handle is required');
}

function readMessage(params: unknown): string {
	if (typeof params === 'object' && params !== null) {
		const message: unknown = Reflect.get(params, 'message');
		if (typeof message === 'string') return message;
	}
	return '';
}

function readLevel(params: unknown): 'info' | 'warn' | 'error' {
	if (typeof params === 'object' && params !== null) {
		const level: unknown = Reflect.get(params, 'level');
		if (level === 'warn' || level === 'error') return level;
	}
	return 'info';
}
