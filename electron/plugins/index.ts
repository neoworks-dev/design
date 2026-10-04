// The built-in main plugins and the order they are mounted in. Order does not matter for
// correctness (plugins wait for what they inject); it only decides who logs first.

import type { PluginEntry } from '../kernel/boot';
import type { ElectronHost } from '../kernel/host';
import { mainAppPlugin } from './app';
import { mainDialogsPlugin } from './dialogs';
import { mainElectronPlugin } from './electron';
import { mainFontsPlugin } from './fonts';
import { mainIpcPlugin } from './ipc';
import { mainProtocolPlugin } from './protocol';
import { mainWindowPlugin, type WindowsConfig } from './windows';

export interface MainPluginOptions {
	host: ElectronHost;
	trustedOrigins: string[];
	buildDirectory: string;
	window: WindowsConfig;
}

export function mainPlugins(options: MainPluginOptions): PluginEntry[] {
	return [
		{ plugin: mainElectronPlugin, config: { host: options.host } },
		{ plugin: mainIpcPlugin, config: { trustedOrigins: options.trustedOrigins } },
		{ plugin: mainProtocolPlugin, config: { buildDirectory: options.buildDirectory } },
		{ plugin: mainWindowPlugin, config: options.window },
		{ plugin: mainAppPlugin },
		{ plugin: mainDialogsPlugin },
		{ plugin: mainFontsPlugin }
	];
}
