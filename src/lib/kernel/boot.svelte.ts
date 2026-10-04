// Kernel boot. Mounts every built-in plugin with Promise.allSettled so one broken plugin never
// blanks the app, and records what happened to each in a rune-backed BootReport that an error UI
// can render.
//
// Plugin order does not matter for correctness: a plugin whose `inject` is not satisfied stays
// PENDING (reported as pending, not as a failure) and activates by itself once the provider shows
// up. A plugin that throws stays FAILED until `retryPlugin` calls `fiber.update()`.

import { FiberState, type Context, type Fiber, type Plugin } from '@neoworks/extension-system';

export type PluginBootStatus = 'active' | 'pending' | 'failed';

export interface PluginBootRecord {
	name: string;
	status: PluginBootStatus;
	/** Message of the error that failed the plugin; only set while `status` is 'failed'. */
	error?: string;
}

interface TrackedPlugin {
	name: string;
	fiber: Fiber | undefined;
	error: unknown;
}

export class BootReport {
	records = $state.raw<PluginBootRecord[]>([]);

	#tracked: TrackedPlugin[] = [];
	#stopWatching: (() => void)[] = [];

	get failures(): PluginBootRecord[] {
		return this.records.filter((record) => record.status === 'failed');
	}

	get pending(): PluginBootRecord[] {
		return this.records.filter((record) => record.status === 'pending');
	}

	/** @internal Used by bootKernel. */
	track(name: string, fiber: Fiber | undefined, error: unknown): void {
		this.#tracked.push({ name, fiber, error });
		this.#publish();
	}

	/** @internal Used by bootKernel. */
	watch(stop: () => void): void {
		this.#stopWatching.push(stop);
	}

	/** Stop following fiber state changes (tests, hot reload). */
	dispose(): void {
		this.#stopWatching.forEach((stop) => stop());
		this.#stopWatching = [];
	}

	/** Recompute the records after a fiber changed state. */
	refresh(): void {
		this.#publish();
	}

	/** Re-run a failed plugin with its current config. Resolves once it settled again. */
	async retryPlugin(name: string): Promise<void> {
		const tracked = this.#tracked.find((candidate) => candidate.name === name);
		if (!tracked) throw new Error(`no plugin named "${name}" in the boot report`);
		const fiber = tracked.fiber;
		if (!fiber) throw new Error(`plugin "${name}" never mounted, it cannot be retried`);
		tracked.error = undefined;
		try {
			fiber.update(fiber.config);
			await fiber.await();
		} catch (error) {
			tracked.error = error;
		}
		this.#publish();
	}

	#publish(): void {
		this.records = this.#tracked.map((tracked) => toRecord(tracked));
	}
}

function toRecord(tracked: TrackedPlugin): PluginBootRecord {
	const state = tracked.fiber?.state;
	if (state === FiberState.ACTIVE) return { name: tracked.name, status: 'active' };
	if (state === FiberState.FAILED || tracked.error !== undefined) {
		return { name: tracked.name, status: 'failed', error: describeError(tracked.error) };
	}
	return { name: tracked.name, status: 'pending' };
}

function describeError(error: unknown): string {
	if (error === undefined) return 'unknown error';
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return JSON.stringify(error);
}

function pluginName(plugin: Plugin): string {
	if (plugin.name && plugin.name !== 'apply') return plugin.name;
	return 'anonymous';
}

// `fiber.update()` starts a restart and drops its promise, so a plugin that fails again would
// surface as an unhandled rejection. The failure is already recorded on the fiber and reported
// through the report, so the dropped promise only needs a handler.
function observeRestart(_config: unknown, _noSave: boolean, next: () => unknown): unknown {
	const restarting = next();
	if (restarting instanceof Promise) restarting.catch(() => undefined);
	return restarting;
}

interface Mounted {
	name: string;
	fiber: Fiber | undefined;
	settled: PromiseLike<unknown>;
}

function mountPlugin(ctx: Context, plugin: Plugin): Mounted {
	const name = pluginName(plugin);
	try {
		const fiber = ctx.plugin(plugin);
		return { name, fiber, settled: fiber };
	} catch (error) {
		return { name, fiber: undefined, settled: Promise.reject(error) };
	}
}

/**
 * Mount `plugins` onto `ctx` and wait until every one settled. Never rejects because of a plugin:
 * failures end up in the returned report.
 */
export async function bootKernel(ctx: Context, plugins: readonly Plugin[]): Promise<BootReport> {
	const report = new BootReport();
	// A fiber can leave PENDING or ACTIVE long after boot (provider arrives, plugin removed), so
	// the report follows state changes of the fibers it tracks.
	report.watch(ctx.on('internal/status', () => report.refresh()));
	report.watch(ctx.on('internal/update', observeRestart, { global: true }));

	const mounted = plugins.map((plugin) => mountPlugin(ctx, plugin));
	const results = await Promise.allSettled(mounted.map((entry) => entry.settled));
	mounted.forEach((entry, index) => {
		const result = results[index];
		const error = result.status === 'rejected' ? result.reason : undefined;
		report.track(entry.name, entry.fiber, error);
	});
	return report;
}
