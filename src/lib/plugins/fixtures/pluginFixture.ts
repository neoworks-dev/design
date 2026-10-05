// Test helpers for the third-party plugin plugins: the providers they sit on, and a way to feed
// them "what main discovered" without a main process.

import type { Context, Plugin } from '@neoworks/extension-system';
import type {
	DesktopBridge,
	DiscoveredPlugin,
	PluginFetchRequest,
	PluginList,
	PluginPermissionDecisions,
	PluginSourceKind
} from '../../../../electron/bridge';
import coreInspectors from '../../../plugins/core-inspectors';
import corePanels from '../../../plugins/core-panels';
import coreTools from '../../../plugins/core-tools';
import pluginApi from '../../../plugins/plugin-api';
import pluginHost from '../../../plugins/plugin-host';
import pluginManifests from '../../../plugins/plugin-manifests';
import { aiProviders } from '../../ai/fixtures/aiFixture';
import type { DesignDocument } from '../../document';
import { CodegenService } from '../../services/codegen';
import type { WorkerFactory } from '../connection';

/** Everything below the plugin plugins: editing services, ai, and the tools service. */
export function pluginProviders(extra: Plugin[] = [], document?: DesignDocument): Plugin[] {
	return aiProviders([coreTools, ...extra], document);
}

/** A `viewport` service stand-in: a fixed camera and a record of zoom requests. */
export function fakeViewportProvider(zoomed: string[][] = []): Plugin {
	return {
		name: 'viewport',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('viewport', {
				x: 12,
				y: 34,
				zoom: 2,
				zoomToSelection: (ids: readonly string[]) => {
					zoomed.push([...ids]);
					return true;
				}
			});
		}
	};
}

/** The `codegen` service, which the inspect-panel plugin provides in the app. */
export const codegenProvider: Plugin = {
	name: 'inspect-panel',
	inject: ['document', 'variables'],
	apply(ctx: Context): void {
		new CodegenService(ctx, ctx.document, ctx.variables);
	}
};

/** `plugin-host` with a test worker factory in place of real Web Workers. */
export function pluginHostWith(
	factory: WorkerFactory,
	config: Record<string, unknown> = {}
): Plugin {
	return {
		name: 'plugin-host',
		inject: pluginHost.inject,
		apply: (ctx: Context) =>
			pluginHost.apply(ctx, pluginHost.Config.parse({ createWorker: factory, ...config }))
	};
}

/** Providers of the API plugin: everything below it, the manifest plugin and a worker host. */
export function pluginApiProviders(
	factory: WorkerFactory,
	options: { config?: Record<string, unknown>; zoomed?: string[][]; document?: DesignDocument } = {}
): Plugin[] {
	return pluginProviders(
		[
			codegenProvider,
			fakeViewportProvider(options.zoomed),
			pluginManifests,
			pluginHostWith(factory, options.config)
		],
		options.document
	);
}

export function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'example',
		name: 'Example',
		version: '1.0.0',
		api: '1.0',
		main: 'main.js',
		permissions: ['document:read', 'document:write'],
		contributes: {
			commands: [{ id: 'example.hello', title: 'Say hello' }]
		},
		...overrides
	};
}

export function discovered(
	manifest: unknown,
	options: { source?: PluginSourceKind; directoryName?: string; trusted?: boolean } = {}
): DiscoveredPlugin {
	const directoryName = options.directoryName === undefined ? 'example' : options.directoryName;
	const source = options.source === undefined ? 'user' : options.source;
	return {
		source,
		directoryName,
		directory: `/plugins/${source}/${directoryName}`,
		manifest,
		trusted: options.trusted === undefined ? true : options.trusted
	};
}

export function listOf(...plugins: DiscoveredPlugin[]): PluginList {
	return { plugins, project: null, projectTrust: null };
}

/** What a fake `window.desktop.plugins` remembers: main's decisions, storage and requests. */
export interface FakePluginState {
	decisions: PluginPermissionDecisions;
	storage: Record<string, Record<string, unknown>>;
	fetched: PluginFetchRequest[];
}

export function newFakePluginState(decisions: PluginPermissionDecisions = {}): FakePluginState {
	return { decisions, storage: {}, fetched: [] };
}

/** A `window.desktop.plugins` section serving `list` and the given plugin files by `file`. */
export function fakePluginsSection(
	list: () => PluginList,
	files: Record<string, string> = {},
	state: FakePluginState = newFakePluginState()
): DesktopBridge['plugins'] {
	return {
		permissions: () => Promise.resolve(structuredClone(state.decisions)),
		setPermission: (pluginId, permission, granted) => {
			const own = { ...state.decisions[pluginId] };
			if (granted === null) delete own[permission];
			else own[permission] = granted;
			state.decisions = { ...state.decisions, [pluginId]: own };
			return Promise.resolve(structuredClone(state.decisions));
		},
		fetch: (request) => {
			state.fetched.push(request);
			return Promise.resolve({ status: 200, statusText: 'OK', headers: {}, body: 'ok' });
		},
		storageGet: (pluginId, key) => Promise.resolve(state.storage[pluginId]?.[key] ?? null),
		storageSet: (pluginId, key, value) => {
			state.storage[pluginId] = { ...state.storage[pluginId], [key]: value };
			return Promise.resolve();
		},
		storageDelete: (pluginId, key) => {
			const own = { ...state.storage[pluginId] };
			delete own[key];
			state.storage[pluginId] = own;
			return Promise.resolve();
		},
		storageKeys: (pluginId) => Promise.resolve(Object.keys(state.storage[pluginId] ?? {})),
		list: () => Promise.resolve(list()),
		setTrust: () => Promise.resolve(list()),
		readFile: (source, directoryName, file) => {
			const text = files[`${source}/${directoryName}/${file}`];
			if (text === undefined) return Promise.reject(new Error(`no file ${file}`));
			return Promise.resolve(text);
		}
	};
}

/** `core-panels` that keeps its state in memory instead of localStorage. */
export const corePanelsInMemory: Plugin = {
	name: 'core-panels',
	inject: corePanels.inject,
	apply: (ctx: Context) =>
		corePanels.apply(ctx, { storage: { getItem: (): null => null, setItem: (): void => {} } })
};

/** Providers of the UI plugin: the API plugin, panels and inspectors on top of the API providers. */
export function pluginUiProviders(
	factory: WorkerFactory,
	options: Parameters<typeof pluginApiProviders>[1] = {}
): Plugin[] {
	return [...pluginApiProviders(factory, options), corePanelsInMemory, coreInspectors, pluginApi];
}
