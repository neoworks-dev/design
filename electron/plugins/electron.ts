// main-electron: provides the `electron` service, the one place Electron is reached from. Boot
// passes the real host; tests pass a fake.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import type { ElectronHost } from '../kernel/host';

export class ElectronService extends Service implements ElectronHost {
	readonly ipcMain: ElectronHost['ipcMain'];
	readonly app: ElectronHost['app'];
	readonly protocol: ElectronHost['protocol'];
	readonly net: ElectronHost['net'];
	readonly shell: ElectronHost['shell'];
	readonly dialog: ElectronHost['dialog'];
	readonly screen: ElectronHost['screen'];
	readonly userData: ElectronHost['userData'];
	readonly createWindow: ElectronHost['createWindow'];
	readonly windows: ElectronHost['windows'];
	readonly windowFromSender: ElectronHost['windowFromSender'];

	constructor(ctx: Context, host: ElectronHost) {
		super(ctx, 'electron');
		this.ipcMain = host.ipcMain;
		this.app = host.app;
		this.protocol = host.protocol;
		this.net = host.net;
		this.shell = host.shell;
		this.dialog = host.dialog;
		this.screen = host.screen;
		this.userData = host.userData;
		this.createWindow = host.createWindow;
		this.windows = host.windows;
		this.windowFromSender = host.windowFromSender;
	}
}

export interface ElectronPluginConfig {
	host: ElectronHost;
}

export const mainElectronPlugin: Plugin.Object<ElectronPluginConfig> = {
	name: 'main-electron',
	apply(ctx, config) {
		new ElectronService(ctx, config.host);
	}
};
