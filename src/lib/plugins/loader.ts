// Mounts one fiber per loadable third-party plugin and keeps them in step with the registry.
//
// The fiber of a plugin (`plugin:<id>`) holds its lazy stubs (see stubs.ts) and offers its own
// context to the registry, which is where the worker host later attaches the worker. Replacing the
// fiber (the manifest changed on disk, the project was trusted) unloads the stubs and the worker
// with it. A fiber that fails to mount marks its plugin `failed`; other plugins are unaffected.

import type { Context, Fiber, Plugin } from '@neoworks/extension-system';
import type { PluginRegistryService } from '../services/pluginRegistry';
import { stubNeeds, type LoadablePluginRecord, type StubContributor } from './stubs';
import { isLoadable, type PluginRecord } from './types';

interface MountedPlugin {
	signature: string;
	fiber: Fiber;
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function asLoadable(record: PluginRecord): LoadablePluginRecord | null {
	if (record.manifest === null || !isLoadable(record)) return null;
	return { ...record, manifest: record.manifest };
}

export function stubPlugin(
	record: LoadablePluginRecord,
	contributors: readonly StubContributor[]
): Plugin.Object {
	return {
		name: `plugin:${record.manifest.id}`,
		inject: stubNeeds(contributors, record.manifest),
		apply(ctx: Context): void {
			ctx.effect(
				() => ctx.pluginRegistry.attachFiberContext(record.manifest.id, ctx),
				`plugin ${record.manifest.id} fiber context`
			);
			for (const contributor of contributors) {
				if (contributor.applies(record.manifest)) contributor.contribute(ctx, record);
			}
		}
	};
}

export class PluginLoader {
	private readonly mounted = new Map<string, MountedPlugin>();
	private queue: Promise<void> = Promise.resolve();

	constructor(
		/** The context the plugin fibers hang under (the `plugin-manifests` plugin's own). */
		private readonly ctx: Context,
		private readonly registry: PluginRegistryService,
		private readonly contributors: readonly StubContributor[]
	) {}

	/** Bring the mounted fibers in line with `records`; calls run one after another. */
	sync(records: readonly PluginRecord[]): Promise<void> {
		this.queue = this.queue.then(() => this.reconcile(records));
		return this.queue;
	}

	/** Ids with a mounted fiber. */
	mountedIds(): string[] {
		return [...this.mounted.keys()].sort();
	}

	private async reconcile(records: readonly PluginRecord[]): Promise<void> {
		const wanted = new Map<string, LoadablePluginRecord>();
		for (const record of records) {
			const loadable = asLoadable(record);
			if (loadable !== null) wanted.set(record.id, loadable);
		}
		for (const [id, mounted] of this.mounted) {
			const next = wanted.get(id);
			if (next !== undefined && next.signature === mounted.signature) continue;
			await this.unmount(id);
		}
		for (const [id, record] of wanted) {
			if (!this.mounted.has(id)) this.mount(id, record);
		}
	}

	// A fiber waiting for a service nobody provides yet stays pending, so mounting must not wait
	// for it to become active: only a failure is reported.
	private mount(id: string, record: LoadablePluginRecord): void {
		const fiber = this.ctx.plugin(stubPlugin(record, this.contributors));
		this.mounted.set(id, { signature: record.signature, fiber });
		Promise.resolve(fiber).catch((error: unknown) => {
			this.registry.setStatus(id, 'failed', describeError(error));
		});
	}

	private async unmount(id: string): Promise<void> {
		const mounted = this.mounted.get(id);
		if (mounted === undefined) return;
		this.mounted.delete(id);
		await mounted.fiber.dispose();
	}

	/** Unload every plugin (the plugin-manifests plugin is unloading). */
	async unmountAll(): Promise<void> {
		this.queue = this.queue.then(async () => {
			for (const id of this.mounted.keys()) await this.unmount(id);
		});
		await this.queue;
	}
}
