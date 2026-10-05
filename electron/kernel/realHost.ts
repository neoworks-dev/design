// The real Electron implementation of ElectronHost. Imported only by main.ts: tests use fakeHost.ts
// because the `electron` package is not usable outside the Electron runtime.

import {
	app,
	BrowserWindow,
	clipboard,
	ClipboardItem,
	dialog,
	ipcMain,
	Menu,
	type MenuItemConstructorOptions,
	net,
	protocol,
	screen,
	shell
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ClipboardContent, ClipboardWrite } from '../bridge';
import { HarnessAgentHost } from '../ai/harnessAgents';
import { qaScript, ScriptedAgentHost } from '../ai/scriptedAgents';
import { fontDirectories, scanFonts } from '../fonts/scan';
import type { AgentHost } from './agentHost';
import type {
	ElectronHost,
	MessageBoxRequest,
	OpenDialogRequest,
	RendererObserver,
	SaveDialogRequest,
	SenderHandle,
	WindowEventName,
	WindowHandle,
	WindowOptions
} from './host';

function createPluginFilesHost(): ElectronHost['pluginFiles'] {
	return {
		listDirectories: async (directory) => {
			try {
				const entries = await fs.promises.readdir(directory, { withFileTypes: true });
				return entries
					.filter((entry) => entry.isDirectory())
					.map((entry) => entry.name)
					.sort();
			} catch {
				return [];
			}
		},
		readText: async (file) => {
			try {
				return await fs.promises.readFile(file, 'utf8');
			} catch {
				return undefined;
			}
		},
		ensureDirectory: async (directory) => {
			await fs.promises.mkdir(directory, { recursive: true });
		},
		watch: (directory, onChange) => {
			try {
				const watcher = fs.watch(directory, { recursive: true }, () => onChange());
				watcher.on('error', () => watcher.close());
				return () => watcher.close();
			} catch {
				return () => {};
			}
		}
	};
}

async function readBlobType(item: ClipboardItem, type: string): Promise<Blob | null> {
	if (!item.types.includes(type)) return null;
	const blob = await item.getType(type);
	if (blob instanceof Blob) return blob;
	return null;
}

async function readClipboard(): Promise<ClipboardContent> {
	const content: ClipboardContent = { text: null, html: null, png: null };
	for (const item of await clipboard.read()) {
		const text = await readBlobType(item, 'text/plain');
		if (text !== null && content.text === null) content.text = await text.text();
		const html = await readBlobType(item, 'text/html');
		if (html !== null && content.html === null) content.html = await html.text();
		const png = await readBlobType(item, 'image/png');
		if (png !== null && content.png === null) content.png = new Uint8Array(await png.arrayBuffer());
	}
	return content;
}

function writeClipboard(content: ClipboardWrite): Promise<void> {
	const entries: Record<string, Blob> = {};
	if (content.text !== undefined)
		entries['text/plain'] = new Blob([content.text], { type: 'text/plain' });
	if (content.html !== undefined)
		entries['text/html'] = new Blob([content.html], { type: 'text/html' });
	if (content.png !== undefined) {
		entries['image/png'] = new Blob([Buffer.from(content.png)], { type: 'image/png' });
	}
	return clipboard.write([new ClipboardItem(entries)]);
}

function toFilters(
	filters: OpenDialogRequest['filters']
): { name: string; extensions: string[] }[] | undefined {
	if (!filters) return undefined;
	return filters.map((filter) => ({ name: filter.name, extensions: filter.extensions }));
}

// `bun run qa` cannot click native dialogs on its virtual display. In a QA session only, these
// variables answer them: DESIGN_QA_OPEN_PATH / DESIGN_QA_SAVE_PATH give the chosen file and
// DESIGN_QA_MESSAGE_BOX the index of the chosen button. Never set in normal use.
function qaAnswer(name: string): string | undefined {
	if (process.env.DESIGN_QA !== '1') return undefined;
	const value = process.env[name];
	if (value === undefined || value === '') return undefined;
	return value;
}

type OpenProperty = 'openFile' | 'openDirectory' | 'createDirectory' | 'multiSelections';

function openProperties(request: OpenDialogRequest): OpenProperty[] {
	if (request.directory === true) return ['openDirectory', 'createDirectory'];
	if (request.multiple) return ['openFile', 'multiSelections'];
	return ['openFile'];
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
		getNormalBounds: () => window.getNormalBounds(),
		isDestroyed: () => window.isDestroyed(),
		send: (channel, payload) => webContents.send(channel, payload),
		on: (event: WindowEventName, listener) => {
			if (event === 'did-finish-load') {
				webContents.on('did-finish-load', listener);
				return () => webContents.off('did-finish-load', listener);
			}
			// The names of the remaining events are exactly Electron's BrowserWindow events.
			window.on(event as 'closed', listener);
			return () => window.off(event as 'closed', listener);
		},
		onCloseRequest: (handler) => {
			let deciding = false;
			let allowing = false;
			const onClose = (event: { preventDefault(): void }): void => {
				if (allowing) return;
				event.preventDefault();
				if (deciding) return;
				deciding = true;
				void handler()
					.catch(() => true)
					.then((allow) => {
						deciding = false;
						if (!allow || window.isDestroyed()) return;
						allowing = true;
						window.close();
					});
			};
			window.on('close', onClose);
			return () => {
				window.off('close', onClose);
			};
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

// DESIGN_QA_AI=fake (QA sessions only) swaps the harness for a scripted agent, so the chat panel
// can be driven without credentials or a model. Never set in normal use.
function createAgentHost(): AgentHost {
	if (process.env.DESIGN_QA === '1' && process.env.DESIGN_QA_AI === 'fake') {
		return new ScriptedAgentHost(qaScript);
	}
	return new HarnessAgentHost();
}

export function createRealHost(): ElectronHost {
	const handles = new Map<number, WindowHandle>();
	const openFileForwarders = new Map<
		unknown,
		(event: { preventDefault(): void }, path: string) => void
	>();
	const secondInstanceForwarders = new Map<unknown, (event: unknown, argv: string[]) => void>();

	function createWindow(options: WindowOptions): WindowHandle {
		const window = new BrowserWindow({
			width: options.width,
			height: options.height,
			x: options.x,
			y: options.y,
			minWidth: options.minWidth,
			minHeight: options.minHeight,
			frame: options.frame,
			titleBarStyle: options.titleBarStyle,
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
				if (event === 'open-file') {
					const forward = (electronEvent: { preventDefault(): void }, path: string): void => {
						electronEvent.preventDefault();
						(listener as (path: string) => void)(path);
					};
					openFileForwarders.set(listener, forward);
					app.on('open-file', forward);
					return;
				}
				if (event === 'second-instance') {
					const forward = (_event: unknown, argv: string[]): void => {
						(listener as (argv: string[]) => void)(argv);
					};
					secondInstanceForwarders.set(listener, forward);
					app.on('second-instance', forward);
					return;
				}
				app.on(event as 'activate', listener as () => void);
			},
			off: (event, listener) => {
				if (event === 'open-file') {
					const forward = openFileForwarders.get(listener);
					if (forward) app.off('open-file', forward);
					return;
				}
				if (event === 'second-instance') {
					const forward = secondInstanceForwarders.get(listener);
					if (forward) app.off('second-instance', forward);
					return;
				}
				app.off(event as 'activate', listener as () => void);
			},
			quit: () => app.quit(),
			getVersion: () => app.getVersion(),
			getPath: (name) => app.getPath(name),
			requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
			addRecentDocument: (target) => app.addRecentDocument(target),
			clearRecentDocuments: () => app.clearRecentDocuments(),
			platform: process.platform
		},
		protocol: {
			handle: (scheme, handler) => protocol.handle(scheme, handler),
			unhandle: (scheme) => protocol.unhandle(scheme)
		},
		net: { fetch: (url, init) => net.fetch(url, init) },
		shell: {
			openExternal: (url) => shell.openExternal(url),
			showItemInFolder: (file) => shell.showItemInFolder(file)
		},
		dialog: {
			showOpenDialog: async (request) => {
				// a folder pick (export of several files) is answered by DESIGN_QA_SAVE_PATH
				const answer = qaAnswer(
					request.directory === true ? 'DESIGN_QA_SAVE_PATH' : 'DESIGN_QA_OPEN_PATH'
				);
				if (answer !== undefined) return [answer];
				const result = await dialog.showOpenDialog({
					title: request.title,
					defaultPath: request.defaultPath,
					filters: toFilters(request.filters),
					properties: openProperties(request)
				});
				if (result.canceled) return null;
				return result.filePaths;
			},
			showSaveDialog: async (request: SaveDialogRequest) => {
				const answer = qaAnswer('DESIGN_QA_SAVE_PATH');
				if (answer !== undefined) return answer;
				const result = await dialog.showSaveDialog({
					title: request.title,
					defaultPath: request.defaultPath,
					filters: toFilters(request.filters)
				});
				if (result.canceled || result.filePath === '') return null;
				return result.filePath;
			},
			showMessageBox: async (request: MessageBoxRequest) => {
				const answer = qaAnswer('DESIGN_QA_MESSAGE_BOX');
				if (answer !== undefined) return Number(answer);
				// Nobody sees a native box on the virtual display, so say in the log what is waiting.
				if (process.env.DESIGN_QA === '1') {
					process.stdout.write(`[qa] native message box waiting: ${request.message}\n`);
				}
				const result = await dialog.showMessageBox({
					type: 'question',
					message: request.message,
					detail: request.detail,
					buttons: request.buttons,
					defaultId: request.defaultId,
					cancelId: request.cancelId === undefined ? request.buttons.length - 1 : request.cancelId,
					noLink: true
				});
				return result.response;
			}
		},
		clipboard: {
			read: () => readClipboard(),
			write: (content) => writeClipboard(content)
		},
		menu: {
			setApplicationMenu: (items) =>
				Menu.setApplicationMenu(Menu.buildFromTemplate(items as MenuItemConstructorOptions[]))
		},
		screen: { workAreas: () => screen.getAllDisplays().map((display) => display.workArea) },
		userData: {
			readText: (name) => {
				try {
					return fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8');
				} catch {
					return undefined;
				}
			},
			writeText: (name, text) => {
				// Temp file then rename: a crash mid-write never leaves a half-written file behind.
				const target = path.join(app.getPath('userData'), name);
				const temporary = `${target}.tmp`;
				fs.writeFileSync(temporary, text);
				fs.renameSync(temporary, target);
			}
		},
		fonts: {
			scan: () => scanFonts(fontDirectories(process.platform, app.getPath('home'), process.env)),
			read: async (file) => new Uint8Array(await fs.promises.readFile(file))
		},
		pluginFiles: createPluginFilesHost(),
		agents: createAgentHost(),
		createWindow,
		windows: () => [...handles.values()],
		windowFromSender: (sender) => {
			const handle = handles.get(sender.id);
			if (!handle) return null;
			return handle;
		}
	};
}
