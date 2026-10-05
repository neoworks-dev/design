// The built-in main plugins and the order they are mounted in. Order does not matter for
// correctness (plugins wait for what they inject); it only decides who logs first.

import type { PluginEntry } from '../kernel/boot';
import type { ElectronHost } from '../kernel/host';
import { mainAiPlugin } from './ai';
import { mainArchivePlugin } from './archive';
import { mainAppPlugin } from './app';
import { mainAssetsPlugin } from './assets';
import { mainClipboardPlugin } from './clipboard';
import { mainDiagnosticsPlugin } from './diagnostics';
import { mainDialogsPlugin } from './dialogs';
import { mainExportsPlugin } from './exports';
import { mainFilesPlugin } from './files';
import { mainLibraryPlugin } from './library';
import { mainLibraryOperationsPlugin } from './libraryOperations';
import { mainElectronPlugin } from './electron';
import { mainFontsPlugin } from './fonts';
import { mainIpcPlugin } from './ipc';
import { mainMenuPlugin } from './menu';
import { mainPluginsPlugin } from './pluginDiscovery';
import { mainPluginPermissionsPlugin } from './pluginPermissions';
import { mainPluginStoragePlugin } from './pluginStorage';
import { mainProtocolPlugin } from './protocol';
import { mainSettingsPlugin } from './settings';
import { mainStorePlugin } from './store';
import { mainWindowPlugin, type WindowsConfig } from './windows';

export interface MainPluginOptions {
	host: ElectronHost;
	trustedOrigins: string[];
	buildDirectory: string;
	/** The `plugins/` directory bundled with the app (third-party plugin discovery). */
	bundledPluginsDirectory: string;
	window: WindowsConfig;
	/** Design files named on the command line of this launch. */
	launchPaths?: string[];
	/** The library root; default: `DRAFTBOARD_LIBRARY_DIR` or the platform's data directory. */
	libraryDirectory?: string;
}

export function mainPlugins(options: MainPluginOptions): PluginEntry[] {
	return [
		{ plugin: mainElectronPlugin, config: { host: options.host } },
		{ plugin: mainIpcPlugin, config: { trustedOrigins: options.trustedOrigins } },
		{ plugin: mainProtocolPlugin, config: { buildDirectory: options.buildDirectory } },
		{ plugin: mainWindowPlugin, config: options.window },
		{ plugin: mainAppPlugin },
		{ plugin: mainDiagnosticsPlugin },
		{ plugin: mainDialogsPlugin },
		{ plugin: mainClipboardPlugin },
		{ plugin: mainExportsPlugin },
		{ plugin: mainMenuPlugin },
		{ plugin: mainFontsPlugin },
		{ plugin: mainSettingsPlugin },
		{ plugin: mainAiPlugin },
		{ plugin: mainLibraryPlugin, config: { libraryDirectory: options.libraryDirectory } },
		{ plugin: mainStorePlugin },
		{ plugin: mainAssetsPlugin },
		{ plugin: mainPluginsPlugin, config: { bundledDirectory: options.bundledPluginsDirectory } },
		{ plugin: mainArchivePlugin },
		{ plugin: mainPluginPermissionsPlugin },
		{ plugin: mainPluginStoragePlugin },
		{ plugin: mainFilesPlugin, config: { launchPaths: options.launchPaths } },
		{ plugin: mainLibraryOperationsPlugin }
	];
}
