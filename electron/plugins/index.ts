// The built-in main plugins and the order they are mounted in. Order does not matter for
// correctness (plugins wait for what they inject); it only decides who logs first.

import type { PluginEntry } from '../kernel/boot';
import type { ElectronHost } from '../kernel/host';
import { mainAppPlugin } from './app';
import { mainAssetsPlugin } from './assets';
import { mainClipboardPlugin } from './clipboard';
import { mainDialogsPlugin } from './dialogs';
import { mainFilesPlugin } from './files';
import { mainElectronPlugin } from './electron';
import { mainFontsPlugin } from './fonts';
import { mainIpcPlugin } from './ipc';
import { mainProtocolPlugin } from './protocol';
import { mainSettingsPlugin } from './settings';
import { mainStorePlugin } from './store';
import { mainWindowPlugin, type WindowsConfig } from './windows';

export interface MainPluginOptions {
	host: ElectronHost;
	trustedOrigins: string[];
	buildDirectory: string;
	window: WindowsConfig;
	/** Design files named on the command line of this launch. */
	launchPaths?: string[];
}

export function mainPlugins(options: MainPluginOptions): PluginEntry[] {
	return [
		{ plugin: mainElectronPlugin, config: { host: options.host } },
		{ plugin: mainIpcPlugin, config: { trustedOrigins: options.trustedOrigins } },
		{ plugin: mainProtocolPlugin, config: { buildDirectory: options.buildDirectory } },
		{ plugin: mainWindowPlugin, config: options.window },
		{ plugin: mainAppPlugin },
		{ plugin: mainDialogsPlugin },
		{ plugin: mainClipboardPlugin },
		{ plugin: mainFontsPlugin },
		{ plugin: mainSettingsPlugin },
		{ plugin: mainStorePlugin },
		{ plugin: mainAssetsPlugin },
		{ plugin: mainFilesPlugin, config: { launchPaths: options.launchPaths } }
	];
}
