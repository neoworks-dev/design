// The real Electron implementation of ElectronHost. Imported only by main.ts: tests use fakeHost.ts
// because the `electron` package is not usable outside the Electron runtime.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import type {
	ElectronHost,
	OpenDialogRequest,
	RendererObserver,
	SaveDialogRequest,
	SenderHandle,
	WindowEventName,
	WindowHandle,
	WindowOptions
} from './host';

function toFilters(
	filters: OpenDialogRequest['filters']
): { name: string; extensions: string[] }[] | undefined {
	if (!filters) return undefined;
	return filters.map((filter) => ({ name: filter.name, extensions: filter.extensions }));
}

function wrapWindow(window: BrowserWindow): WindowHandle {
	const { webContents } = window;
	const sender: SenderHandle = { id: webContents.id };
	return {
		id: window.id,
		sender,
		loadURL: (url) => window.loadURL(url),
		minimize: () => window.minimize(),
		maximize: () => window.maximize(),
		unmaximize: () => window.unmaximize(),
		restore: () => window.restore(),
		focus: () => window.focus(),
		close: () => window.close(),
		isMaximized: () => window.isMaximized(),
		isMinimized: () => window.isMinimized(),
		isDestroyed: () => window.isDestroyed(),
		send: (channel, payload) => webContents.send(channel, payload),
		on: (event: WindowEventName, listener) => {
			if (event === 'did-finish-load') {
				webContents.on('did-finish-load', listener);
				return () => webContents.off('did-finish-load', listener);
			}
			if (event === 'closed') {
				window.on('closed', listener);
				return () => window.off('closed', listener);
			}
			if (event === 'maximize') {
				window.on('maximize', listener);
				return () => window.off('maximize', listener);
			}
			window.on('unmaximize', listener);
			return () => window.off('unmaximize', listener);
		},
		onNewWindowRequest: (handler) => {
			webContents.setWindowOpenHandler(({ url }) => {
				handler(url);
				return { action: 'deny' };
			});
		},
		openDevTools: () => webContents.openDevTools({ mode: 'detach' }),
		observeRenderer: (observer: RendererObserver) => {
			const onConsole = (event: { level: string; message: string }): void => {
				observer.consoleMessage(event.level, event.message);
			};
			const onGone = (_event: unknown, details: { reason: string; exitCode: number }): void => {
				observer.gone(details.reason, details.exitCode);
			};
			webContents.on('console-message', onConsole);
			webContents.on('render-process-gone', onGone);
			return () => {
				webContents.off('console-message', onConsole);
				webContents.off('render-process-gone', onGone);
			};
		}
	};
}

export function createRealHost(): ElectronHost {
	const handles = new Map<number, WindowHandle>();

	function createWindow(options: WindowOptions): WindowHandle {
		const window = new BrowserWindow({
			width: options.width,
			height: options.height,
			minWidth: options.minWidth,
			minHeight: options.minHeight,
			frame: options.frame,
			backgroundColor: options.backgroundColor,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: options.preloadPath
			}
		});
		const handle = wrapWindow(window);
		handles.set(handle.sender.id, handle);
		window.on('closed', () => handles.delete(handle.sender.id));
		return handle;
	}

	return {
		ipcMain: {
			handle: (channel, listener) => ipcMain.handle(channel, listener),
			removeHandler: (channel) => ipcMain.removeHandler(channel)
		},
		app: {
			whenReady: () => app.whenReady(),
			on: (event, listener) => {
				app.on(event as 'activate', listener as () => void);
			},
			off: (event, listener) => {
				app.off(event as 'activate', listener as () => void);
			},
			quit: () => app.quit(),
			getVersion: () => app.getVersion(),
			getPath: (name) => app.getPath(name),
			requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
			platform: process.platform
		},
		protocol: {
			handle: (scheme, handler) => protocol.handle(scheme, handler),
			unhandle: (scheme) => protocol.unhandle(scheme)
		},
		net: { fetch: (url) => net.fetch(url) },
		shell: { openExternal: (url) => shell.openExternal(url) },
		dialog: {
			showOpenDialog: async (request) => {
				const result = await dialog.showOpenDialog({
					title: request.title,
					defaultPath: request.defaultPath,
					filters: toFilters(request.filters),
					properties: request.multiple ? ['openFile', 'multiSelections'] : ['openFile']
				});
				if (result.canceled) return null;
				return result.filePaths;
			},
			showSaveDialog: async (request: SaveDialogRequest) => {
				const result = await dialog.showSaveDialog({
					title: request.title,
					defaultPath: request.defaultPath,
					filters: toFilters(request.filters)
				});
				if (result.canceled || result.filePath === '') return null;
				return result.filePath;
			}
		},
		createWindow,
		windows: () => [...handles.values()],
		windowFromSender: (sender) => {
			const handle = handles.get(sender.id);
			if (!handle) return null;
			return handle;
		}
	};
}
