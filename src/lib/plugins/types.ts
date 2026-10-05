// Shared types of the third-party plugin system: what the registry knows about a plugin, and the
// seam between the manifest stubs (`plugin-manifests`) and the thing that runs plugin code
// (`plugin-host`).

import type { PluginSourceKind } from '../../../electron/bridge';
import type { RegistryEntry } from '../registries/registry.svelte';
import type { ManifestIssue, PluginManifest } from './manifest';

/**
 * Where a plugin is in its life:
 *   inactive      loadable, its stubs are registered, the worker is not running
 *   active        the worker runs
 *   failed        the worker crashed, timed out or refused to start (see `error`)
 *   invalid       the manifest is unreadable or breaks the schema (see `errors`)
 *   incompatible  written for an API version this app does not provide
 *   untrusted     lives in a project the user has not trusted
 *   shadowed      another plugin with the same id was found in an earlier root
 */
export type PluginStatus =
	'inactive' | 'active' | 'failed' | 'invalid' | 'incompatible' | 'untrusted' | 'shadowed';

export interface PluginRecord extends RegistryEntry {
	/** The manifest's id; `invalid:<source>:<directory>` when there is no usable manifest. */
	id: string;
	source: PluginSourceKind;
	directoryName: string;
	directory: string;
	/** The validated manifest; `null` for an invalid one. */
	manifest: PluginManifest | null;
	status: PluginStatus;
	/** Schema problems with their paths, for `invalid`. */
	errors: ManifestIssue[];
	warnings: string[];
	/** Why the plugin does not run: a sentence for `incompatible`, `shadowed` and `failed`. */
	error: string | null;
	/** Changes when the manifest, root or trust changes; a stub fiber is rebuilt then. */
	signature: string;
}

/** Statuses of plugins whose stubs are registered. */
export function isLoadable(record: PluginRecord): boolean {
	if (record.manifest === null) return false;
	return record.status === 'inactive' || record.status === 'active' || record.status === 'failed';
}

/**
 * What the manifest stubs call to reach plugin code. The `plugin-host` plugin provides it
 * (`pluginRegistry.setRuntime`); until it does, stubs fail with a clear message instead of hanging.
 */
export interface PluginRuntime {
	/** Start the plugin's worker unless it already runs; resolves once the plugin is loaded. */
	activate(pluginId: string): Promise<void>;
	/** Run one of the plugin's commands in its worker as one undo step; activates first. */
	runCommand(pluginId: string, commandId: string, args: unknown): Promise<void>;
	/** Call a handler the plugin registered (`aiTool`, ...) and await its answer; activates first. */
	call(pluginId: string, method: string, params: unknown): Promise<unknown>;
	/** Send a fire-and-forget message to the plugin (tool pointer events); activates first. */
	notify(pluginId: string, method: string, params: unknown): void;
}

export class PluginRuntimeUnavailableError extends Error {
	constructor(pluginId: string) {
		super(`plugin "${pluginId}" cannot run: the plugin host is not loaded`);
		this.name = 'PluginRuntimeUnavailableError';
	}
}
