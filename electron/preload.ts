import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';

// The single API surface the renderer sees. The renderer never touches Node or
// ipcRenderer directly.
const bridge: DesktopBridge = {
	window: {
		minimize: () => ipcRenderer.invoke('window:minimize'),
		toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
		close: () => ipcRenderer.invoke('window:close')
	},
	system: {
		platform: process.platform,
		arch: process.arch
	}
};

contextBridge.exposeInMainWorld('desktop', bridge);
