// The slice of Electron the main kernel uses, as plain interfaces. Plugins reach Electron through
// the `electron` service (which wraps one of these) instead of importing it, so tests can provide
// a fake host (see fakeHost.ts) and no plugin holds a hidden singleton dependency.

import type { AppPathName, ClipboardContent, ClipboardWrite, FileFilter } from '../bridge';
import type { AgentHost } from './agentHost';

/** The renderer that sent an IPC message: a webContents id. */
export interface SenderHandle {
	readonly id: number;
}

/** What `ipcMain.handle` listeners receive; a subset of `IpcMainInvokeEvent`. */
export interface IpcInvokeEvent {
	sender: SenderHandle;
	/** `null` when the frame was already destroyed. `parent` is `null` for the top frame. */
	senderFrame: { url: string; parent: unknown } | null;
}
export type IpcListener = (event: IpcInvokeEvent, payload: unknown) => unknown;

export interface IpcMainApi {
	handle(channel: string, listener: IpcListener): void;
	removeHandler(channel: string): void;
}

export interface AppEvents {
	'before-quit': (event: { preventDefault(): void }) => void;
	'window-all-closed': () => void;
	/** Another launch was attempted; `argv` is its command line (may name a file to open). */
	'second-instance': (argv: string[]) => void;
	/** macOS: the user opened a document with the app (Finder, dock, recent documents). */
	'open-file': (path: string) => void;
	activate: () => void;
}
export type AppEventName = keyof AppEvents;

export interface AppApi {
	whenReady(): Promise<void>;
	on<Name extends AppEventName>(event: Name, listener: AppEvents[Name]): void;
	off<Name extends AppEventName>(event: Name, listener: AppEvents[Name]): void;
	quit(): void;
	getVersion(): string;
	getPath(name: AppPathName): string;
	requestSingleInstanceLock(): boolean;
	/** The OS's recent documents list (dock, taskbar, Finder); a no-op where there is none. */
	addRecentDocument(path: string): void;
	clearRecentDocuments(): void;
	platform: NodeJS.Platform;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WindowOptions {
	width: number;
	height: number;
	/** Position; absent lets the OS place (centre) the window. */
	x?: number;
	y?: number;
	minWidth: number;
	minHeight: number;
	frame: boolean;
	/** `hidden` draws no title bar but keeps the macOS traffic lights (with `frame: true`). */
	titleBarStyle?: 'hidden';
	backgroundColor: string;
	preloadPath: string;
}

export interface RendererObserver {
	consoleMessage(level: string, message: string): void;
	gone(reason: string, exitCode: number): void;
}

export type WindowEventName =
	'closed' | 'close' | 'maximize' | 'unmaximize' | 'resize' | 'move' | 'did-finish-load';

export interface WindowHandle {
	readonly id: number;
	readonly sender: SenderHandle;
	loadURL(url: string): Promise<void>;
	minimize(): void;
	maximize(): void;
	unmaximize(): void;
	restore(): void;
	focus(): void;
	close(): void;
	isMaximized(): boolean;
	isMinimized(): boolean;
	/** The restored (not maximized) bounds, also while the window is maximized. */
	getNormalBounds(): Rect;
	isDestroyed(): boolean;
	/** Push a message to the window's renderer. */
	send(channel: string, payload: unknown): void;
	/** Returns the function that removes the listener. */
	on(event: WindowEventName, listener: () => void): () => void;
	/**
	 * Called when something asks the window to close (the close button, Alt+F4, `close()`). The
	 * window stays open until the handler's promise resolves to `true`; `false` keeps it open.
	 * Returns the function that removes the handler.
	 */
	onCloseRequest(handler: () => Promise<boolean>): () => void;
	/** Called for links the page tries to open in a new window; the window itself always denies. */
	onNewWindowRequest(handler: (url: string) => void): void;
	openDevTools(): void;
	observeRenderer(observer: RendererObserver): () => void;
}

export interface OpenDialogRequest {
	title?: string;
	defaultPath?: string;
	filters?: FileFilter[];
	multiple: boolean;
	/** Pick a folder instead of files. */
	directory?: boolean;
}
export interface SaveDialogRequest {
	title?: string;
	defaultPath?: string;
	filters?: FileFilter[];
}

/** An installed font file as the host found it. */
export interface HostFontFile {
	family: string;
	style: string;
	file: string;
}

export interface MessageBoxRequest {
	message: string;
	detail?: string;
	buttons: string[];
	/** Button preselected; defaults to the first. */
	defaultId?: number;
	/** Button an Escape press (or closing the box) answers with; defaults to the last. */
	cancelId?: number;
}

/** One entry of a native menu template, a subset of Electron's `MenuItemConstructorOptions`. */
export interface HostMenuItem {
	label?: string;
	type?: 'normal' | 'separator' | 'checkbox' | 'submenu';
	accelerator?: string;
	enabled?: boolean;
	checked?: boolean;
	/** Show the accelerator without claiming the key (the renderer's keymap handles it). */
	registerAccelerator?: boolean;
	role?: string;
	click?: () => void;
	submenu?: HostMenuItem[];
}

/** The file system as plugin discovery needs it: reading plugin directories and watching them. */
export interface PluginFilesHost {
	/** Names of the subdirectories of `directory`, sorted; empty when it does not exist. */
	listDirectories(directory: string): Promise<string[]>;
	/** The file's text, or `undefined` when it does not exist or cannot be read. */
	readText(file: string): Promise<string | undefined>;
	/** Create `directory` (and parents) when missing. */
	ensureDirectory(directory: string): Promise<void>;
	/**
	 * Call `onChange` when something below `directory` is added, removed or edited. Returns the
	 * function that closes the watcher; a directory that does not exist is not watched.
	 */
	watch(directory: string, onChange: () => void): () => void;
}

export interface ElectronHost {
	ipcMain: IpcMainApi;
	app: AppApi;
	protocol: {
		handle(scheme: string, handler: (request: { url: string }) => Promise<Response>): void;
		unhandle(scheme: string): void;
	};
	net: {
		fetch(
			url: string,
			init?: {
				method?: string;
				headers?: Record<string, string>;
				body?: string;
				signal?: AbortSignal;
			}
		): Promise<Response>;
	};
	shell: {
		openExternal(url: string): Promise<void>;
		/** Show a file selected in the OS file manager. */
		showItemInFolder(file: string): void;
	};
	dialog: {
		showOpenDialog(request: OpenDialogRequest): Promise<string[] | null>;
		showSaveDialog(request: SaveDialogRequest): Promise<string | null>;
		/** Resolves with the index of the button the user chose. */
		showMessageBox(request: MessageBoxRequest): Promise<number>;
	};
	/** The OS clipboard. */
	clipboard: {
		read(): Promise<ClipboardContent>;
		write(content: ClipboardWrite): Promise<void>;
	};
	/** The native application menu. */
	menu: { setApplicationMenu(items: HostMenuItem[]): void };
	/** Work areas of the connected displays, primary first. */
	screen: { workAreas(): Rect[] };
	/** Small text files in the app's user data directory (window state, ...). */
	userData: {
		readText(name: string): string | undefined;
		writeText(name: string, text: string): void;
	};
	/** Plugin directories: listing, reading and watching. */
	pluginFiles: PluginFilesHost;
	/** Installed system fonts; `scan` reads the font directories, `read` returns a file's bytes. */
	fonts: {
		scan(): Promise<HostFontFile[]>;
		read(file: string): Promise<Uint8Array>;
	};
	/** The AI agent harness. */
	agents: AgentHost;
	createWindow: (options: WindowOptions) => WindowHandle;
	windows: () => WindowHandle[];
	windowFromSender: (sender: SenderHandle) => WindowHandle | null;
}
