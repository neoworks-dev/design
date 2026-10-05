// The `pluginRegistry` service: every third-party plugin main found, validated, with its status.
// Provided by plugin `plugin-manifests`.
//
//   registry.ingest(list)            main's plugin list in, records out (validated, shadowing resolved)
//   registry.records() / get(id)     reactive reads, for the plugin manager and the host
//   registry.setStatus(id, ...)      the host reports active / failed
//   registry.setRuntime(runtime)     the host says how stubs reach plugin code
//
// A plugin's id is its manifest id. Roots are ingested in the order main lists them (bundled, user,
// project); the first plugin with an id wins and later ones are `shadowed`.

import { Service, type Context } from '@neoworks/extension-system';
import type { DiscoveredPlugin, PluginList } from '../../../electron/bridge';
import {
	checkApiCompatibility,
	parseManifest,
	type ManifestIssue,
	type PluginManifest
} from '../plugins/manifest';
import {
	PluginRuntimeUnavailableError,
	type PluginRecord,
	type PluginRuntime,
	type PluginStatus
} from '../plugins/types';
import { Registry } from '../registries/registry.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		pluginRegistry: PluginRegistryService;
	}
}

function invalidId(plugin: DiscoveredPlugin): string {
	return `invalid:${plugin.source}:${plugin.directoryName}`;
}

function signatureOf(plugin: DiscoveredPlugin, manifest: PluginManifest | null): string {
	return JSON.stringify([plugin.source, plugin.directoryName, plugin.trusted, manifest]);
}

function recordShape(
	plugin: DiscoveredPlugin
): Pick<PluginRecord, 'source' | 'directoryName' | 'directory'> {
	return {
		source: plugin.source,
		directoryName: plugin.directoryName,
		directory: plugin.directory
	};
}

function invalidRecord(plugin: DiscoveredPlugin, errors: ManifestIssue[]): PluginRecord {
	return {
		id: invalidId(plugin),
		...recordShape(plugin),
		manifest: null,
		status: 'invalid',
		errors,
		warnings: [],
		error: errors.map((issue) => issue.message).join('; '),
		signature: signatureOf(plugin, null)
	};
}

/** The record for one discovered plugin, before shadowing and runtime state are applied. */
export function recordFor(plugin: DiscoveredPlugin): PluginRecord {
	if (plugin.manifest === null) {
		const message = plugin.error === undefined ? 'no manifest' : plugin.error;
		return invalidRecord(plugin, [{ path: '', message }]);
	}
	const result = parseManifest(plugin.manifest);
	if (!result.ok) return invalidRecord(plugin, result.errors);
	const { manifest } = result;
	const base: PluginRecord = {
		id: manifest.id,
		...recordShape(plugin),
		manifest,
		status: 'inactive',
		errors: [],
		warnings: result.warnings,
		error: null,
		signature: signatureOf(plugin, manifest)
	};
	const compatibility = checkApiCompatibility(manifest.api);
	if (!compatibility.compatible) {
		return { ...base, status: 'incompatible', error: compatibility.error };
	}
	base.warnings = [...base.warnings, ...compatibility.warnings];
	if (!plugin.trusted) {
		return { ...base, status: 'untrusted', error: 'the project containing it is not trusted' };
	}
	return base;
}

interface RegistryHolder {
	runtime: PluginRuntime | null;
	disposers: Map<string, () => void>;
	contexts: Map<string, Context>;
}

export class PluginRegistryService extends Service {
	readonly registry = new Registry<PluginRecord>();
	// Mutable state lives in a shared object: `isolate` / `intercept` derive services with
	// `Object.create`, and an assignment through a derived service would shadow instead of share.
	private readonly holder: RegistryHolder = {
		runtime: null,
		disposers: new Map(),
		contexts: new Map()
	};

	constructor(ctx: Context) {
		super(ctx, 'pluginRegistry');
	}

	/** Reactive: every plugin found, whatever its status, in discovery order. */
	records(): readonly PluginRecord[] {
		return this.registry.listAll();
	}

	get(id: string): PluginRecord | undefined {
		return this.registry.get(id);
	}

	/**
	 * Replace the known plugins with what `list` describes. A plugin whose manifest, root and trust
	 * did not change keeps its runtime status (`active`, `failed`); everything else restarts as
	 * `inactive`. Returns the new records in order.
	 */
	ingest(list: PluginList): PluginRecord[] {
		const records = this.resolveShadowing(list.plugins.map((plugin) => recordFor(plugin)));
		const previous = new Map(this.registry.listAll().map((record) => [record.id, record]));
		const next = records.map((record) => this.keepRuntimeState(record, previous.get(record.id)));
		for (const id of previous.keys()) {
			if (!next.some((record) => record.id === id)) this.drop(id);
		}
		for (const record of next) this.put(record, previous.get(record.id));
		return next;
	}

	/** The host reports a plugin started, stopped or crashed. */
	setStatus(id: string, status: PluginStatus, error: string | null = null): void {
		const record = this.registry.get(id);
		if (!record) return;
		if (record.status === status && record.error === error) return;
		this.put({ ...record, status, error }, record);
	}

	setRuntime(runtime: PluginRuntime): () => void {
		this.holder.runtime = runtime;
		return () => {
			if (this.holder.runtime === runtime) this.holder.runtime = null;
		};
	}

	/**
	 * A plugin's own fiber context, registered by its stub fiber while it is mounted. The host
	 * attaches the plugin's worker to it, so unloading the plugin terminates the worker.
	 */
	attachFiberContext(id: string, context: Context): () => void {
		this.holder.contexts.set(id, context);
		return () => {
			if (this.holder.contexts.get(id) === context) this.holder.contexts.delete(id);
		};
	}

	fiberContextOf(id: string): Context | undefined {
		return this.holder.contexts.get(id);
	}

	/** The host's runtime; throws when the plugin host is not loaded. */
	runtimeFor(pluginId: string): PluginRuntime {
		const runtime = this.holder.runtime;
		if (runtime === null) throw new PluginRuntimeUnavailableError(pluginId);
		return runtime;
	}

	private resolveShadowing(records: PluginRecord[]): PluginRecord[] {
		const seen = new Map<string, PluginRecord>();
		return records.map((record) => {
			if (record.manifest === null) return record;
			const first = seen.get(record.id);
			if (first === undefined) {
				seen.set(record.id, record);
				return record;
			}
			return {
				...record,
				// The winner owns the plain id; a registry holds one entry per id.
				id: `shadowed:${record.source}:${record.directoryName}`,
				status: 'shadowed',
				error: `another plugin with this id was found first (${first.source}/${first.directoryName})`
			};
		});
	}

	private keepRuntimeState(record: PluginRecord, previous: PluginRecord | undefined): PluginRecord {
		if (previous === undefined || previous.signature !== record.signature) return record;
		if (record.status !== 'inactive') return record;
		if (previous.status !== 'active' && previous.status !== 'failed') return record;
		return { ...record, status: previous.status, error: previous.error };
	}

	private put(record: PluginRecord, previous: PluginRecord | undefined): void {
		if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(record)) return;
		// Registering replaces the entry with the same id; the new disposer removes the new entry.
		this.holder.disposers.set(record.id, this.registry.register(record));
	}

	private drop(id: string): void {
		this.holder.disposers.get(id)?.();
		this.holder.disposers.delete(id);
	}

	snapshotState(): Record<string, unknown> {
		return { plugins: this.registry.listAll().map((record) => `${record.id}:${record.status}`) };
	}
}
