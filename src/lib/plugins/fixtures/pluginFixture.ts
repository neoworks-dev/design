// Test helpers for the third-party plugin plugins: the providers they sit on, and a way to feed
// them "what main discovered" without a main process.

import type { Plugin } from '@neoworks/extension-system';
import type {
	DesktopBridge,
	DiscoveredPlugin,
	PluginList,
	PluginSourceKind
} from '../../../../electron/bridge';
import coreTools from '../../../plugins/core-tools';
import { aiProviders } from '../../ai/fixtures/aiFixture';
import type { DesignDocument } from '../../document';

/** Everything below the plugin plugins: editing services, ai, and the tools service. */
export function pluginProviders(extra: Plugin[] = [], document?: DesignDocument): Plugin[] {
	return aiProviders([coreTools, ...extra], document);
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

/** A `window.desktop.plugins` section serving `list` and the given plugin files by `file`. */
export function fakePluginsSection(
	list: () => PluginList,
	files: Record<string, string> = {}
): DesktopBridge['plugins'] {
	return {
		list: () => Promise.resolve(list()),
		setTrust: () => Promise.resolve(list()),
		readFile: (source, directoryName, file) => {
			const text = files[`${source}/${directoryName}/${file}`];
			if (text === undefined) return Promise.reject(new Error(`no file ${file}`));
			return Promise.resolve(text);
		}
	};
}
