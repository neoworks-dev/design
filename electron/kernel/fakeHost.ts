// An in-memory ElectronHost for tests: a fake `ipcMain` with a handler registry, a scriptable app,
// windows, protocol and dialogs. `snapshot()` is the observable state the standard mount /
// unmount / state-identical plugin test compares.

import type { AppPathName, ClipboardContent } from '../bridge';
import { ScriptedAgentHost, type AgentScript } from '../ai/scriptedAgents';
import type {
	AppEventName,
	AppEvents,
	ElectronHost,
	HostFontFile,
	HostMenuItem,
	IpcInvokeEvent,
	IpcListener,
	MessageBoxRequest,
	OpenDialogRequest,
	Rect,
	RendererObserver,
	SaveDialogRequest,
	SenderHandle,
	WindowEventName,
	WindowHandle,
	WindowOptions
} from './host';

export const TRUSTED_URL = 'app://design/';

/** Replies with one line; tests that care replace `host.agents.script`. */
const defaultFakeScript: AgentScript = function* () {
	yield { type: 'text', text: 'ok' };
};

function compareText(left: string, right: string): number {
	return left.localeCompare(right);
}
function compareEntries(left: [string, unknown], right: [string, unknown]): number {
	return compareText(left[0], right[0]);
}

export class FakeWindow implements WindowHandle {
	readonly sender: SenderHandle;
	readonly sent: { channel: string; payload: unknown }[] = [];
	readonly loadedUrls: string[] = [];
	maximized = false;
	minimized = false;
	/** The restored bounds `getNormalBounds` reports; tests move them with `resizeTo`. */
	normalBounds: Rect;
	focusCount = 0;
	destroyed = false;
	devToolsOpened = false;
	newWindowHandler: ((url: string) => void) | null = null;
	private closeHandlers = new Set<() => Promise<boolean>>();
	observers = new Set<RendererObserver>();
	loadFailuresRemaining = 0;
	private listeners = new Map<WindowEventName, Set<() => void>>();

	constructor(
		readonly id: number,
		readonly options: WindowOptions,
		private readonly onDestroyed: (window: FakeWindow) => void
	) {
		this.sender = { id };
		this.normalBounds = {
			x: options.x === undefined ? 0 : options.x,
			y: options.y === undefined ? 0 : options.y,
			width: options.width,
			height: options.height
		};
	}

	loadURL(url: string): Promise<void> {
		this.loadedUrls.push(url);
		if (this.loadFailuresRemaining > 0) {
			this.loadFailuresRemaining -= 1;
			return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
		}
		return Promise.resolve();
	}
	minimize(): void {
		this.minimized = true;
	}
	maximize(): void {
		this.maximized = true;
		this.fire('maximize');
	}
	unmaximize(): void {
		this.maximized = false;
		this.fire('unmaximize');
	}
	restore(): void {
		this.minimized = false;
	}
	focus(): void {
		this.focusCount += 1;
	}
	/** Like the real window: handlers may keep it open; without any it closes at once. */
	close(): void {
		if (this.destroyed) return;
		this.fire('close');
		if (this.closeHandlers.size === 0) {
			this.destroy();
			return;
		}
		void this.requestClose();
	}
	/** Runs the close handlers; resolves true when the window closed. */
	async requestClose(): Promise<boolean> {
		if (this.destroyed) return true;
		for (const handler of Array.from(this.closeHandlers)) {
			if (!(await handler())) return false;
		}
		this.destroy();
		return true;
	}
	private destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.fire('closed');
		this.onDestroyed(this);
	}
	isMaximized(): boolean {
		return this.maximized;
	}
	isMinimized(): boolean {
		return this.minimized;
	}
	getNormalBounds(): Rect {
		return this.normalBounds;
	}
	isDestroyed(): boolean {
		return this.destroyed;
	}
	send(channel: string, payload: unknown): void {
		this.sent.push({ channel, payload });
	}
	on(event: WindowEventName, listener: () => void): () => void {
		const set = this.listeners.get(event) ?? new Set<() => void>();
		set.add(listener);
		this.listeners.set(event, set);
		return () => {
			set.delete(listener);
		};
	}
	onCloseRequest(handler: () => Promise<boolean>): () => void {
		this.closeHandlers.add(handler);
		return () => {
			this.closeHandlers.delete(handler);
		};
	}
	closeHandlerCount(): number {
		return this.closeHandlers.size;
	}
	onNewWindowRequest(handler: (url: string) => void): void {
		this.newWindowHandler = handler;
	}
	openDevTools(): void {
		this.devToolsOpened = true;
	}
	observeRenderer(observer: RendererObserver): () => void {
		this.observers.add(observer);
		return () => {
			this.observers.delete(observer);
		};
	}
	/** Test driver: the user dragged the window to `bounds`. */
	resizeTo(bounds: Rect): void {
		const moved = bounds.x !== this.normalBounds.x || bounds.y !== this.normalBounds.y;
		this.normalBounds = bounds;
		this.fire('resize');
		if (moved) this.fire('move');
	}
	listenerCount(event: WindowEventName): number {
		return this.listeners.get(event)?.size ?? 0;
	}
	fire(event: WindowEventName): void {
		for (const listener of Array.from(this.listeners.get(event) ?? [])) listener();
	}
}

export interface FakeHostOptions {
	platform?: NodeJS.Platform;
	/** Directories `app.getPath` answers with; unset names are `/fake/<name>`. */
	paths?: Partial<Record<AppPathName, string>>;
	/** When true, `whenReady()` stays pending until `becomeReady()`. */
	deferReady?: boolean;
	/** Work areas of the connected displays, primary first. */
	displays?: Rect[];
	/** Files that already exist in the fake user data directory. */
	files?: Record<string, string>;
	/** Installed fonts: file path to its family, style and bytes. */
	fonts?: Record<string, { family: string; style: string; bytes: Uint8Array }>;
}

export class FakeHost implements ElectronHost {
	readonly handlers = new Map<string, IpcListener>();
	readonly openWindows: FakeWindow[] = [];
	readonly protocolHandlers = new Map<string, (request: { url: string }) => Promise<Response>>();
	readonly appListeners = new Map<AppEventName, Set<(...args: never[]) => void>>();
	readonly openedExternal: string[] = [];
	/** Text files in the fake user data directory, by name. */
	readonly files = new Map<string, string>();
	/** Installed fonts by file path; tests add and remove entries. */
	readonly installedFonts = new Map<string, { family: string; style: string; bytes: Uint8Array }>();
	scanCount = 0;
	readCount = 0;
	displays: Rect[] = [{ x: 0, y: 0, width: 1920, height: 1080 }];
	readonly fetched: string[] = [];
	readonly fetchInits: unknown[] = [];
	paths: Partial<Record<AppPathName, string>> = {};
	quitCount = 0;
	version = '1.2.3';
	openDialogResult: string[] | null = null;
	saveDialogResult: string | null = null;
	lastOpenDialogRequest: OpenDialogRequest | null = null;
	lastSaveDialogRequest: SaveDialogRequest | null = null;
	/** Index of the button `showMessageBox` answers with. */
	messageBoxResult = 0;
	readonly messageBoxRequests: MessageBoxRequest[] = [];
	private nextWindowId = 1;
	private resolveReady: () => void = () => {};
	private readyPromise: Promise<void>;

	constructor(options: FakeHostOptions = {}) {
		const platform = options.platform === undefined ? 'linux' : options.platform;
		for (const [file, font] of Object.entries(options.fonts ?? {}))
			this.installedFonts.set(file, font);
		if (options.displays) this.displays = options.displays;
		for (const [name, text] of Object.entries(options.files ?? {})) this.files.set(name, text);
		this.app.platform = platform;
		this.paths = { ...options.paths };
		if (options.deferReady) {
			this.readyPromise = new Promise<void>((resolve) => {
				this.resolveReady = resolve;
			});
		} else {
			this.readyPromise = Promise.resolve();
		}
	}

	becomeReady(): void {
		this.resolveReady();
	}

	readonly ipcMain = {
		handle: (channel: string, listener: IpcListener): void => {
			if (this.handlers.has(channel)) {
				throw new Error(`Attempted to register a second handler for '${channel}'`);
			}
			this.handlers.set(channel, listener);
		},
		removeHandler: (channel: string): void => {
			this.handlers.delete(channel);
		}
	};

	/** What the OS's recent documents list would hold. */
	readonly osRecentDocuments: string[] = [];

	readonly app: ElectronHost['app'] = {
		whenReady: () => this.readyPromise,
		on: (event, listener) => {
			const set = this.appListeners.get(event) ?? new Set<(...args: never[]) => void>();
			set.add(listener);
			this.appListeners.set(event, set);
		},
		off: (event, listener) => {
			this.appListeners.get(event)?.delete(listener);
		},
		quit: () => {
			this.quitCount += 1;
		},
		getVersion: () => this.version,
		getPath: (name: AppPathName) => this.paths[name] ?? `/fake/${name}`,
		requestSingleInstanceLock: () => true,
		addRecentDocument: (target) => {
			this.osRecentDocuments.push(target);
		},
		clearRecentDocuments: () => {
			this.osRecentDocuments.length = 0;
		},
		platform: 'linux'
	};

	readonly protocol: ElectronHost['protocol'] = {
		handle: (scheme, handler) => {
			this.protocolHandlers.set(scheme, handler);
		},
		unhandle: (scheme) => {
			this.protocolHandlers.delete(scheme);
		}
	};

	readonly net: ElectronHost['net'] = {
		fetch: (url, init) => {
			this.fetched.push(url);
			this.fetchInits.push(init);
			return Promise.resolve(new Response('ok'));
		}
	};

	readonly revealed: string[] = [];

	readonly shell: ElectronHost['shell'] = {
		openExternal: (url) => {
			this.openedExternal.push(url);
			return Promise.resolve();
		},
		showItemInFolder: (file) => {
			this.revealed.push(file);
		}
	};

	readonly dialog: ElectronHost['dialog'] = {
		showOpenDialog: (request) => {
			this.lastOpenDialogRequest = request;
			return Promise.resolve(this.openDialogResult);
		},
		showSaveDialog: (request) => {
			this.lastSaveDialogRequest = request;
			return Promise.resolve(this.saveDialogResult);
		},
		showMessageBox: (request) => {
			this.messageBoxRequests.push(request);
			return Promise.resolve(this.messageBoxResult);
		}
	};

	/** What the fake OS clipboard holds; tests read and set it directly. */
	clipboardContent: ClipboardContent = { text: null, html: null, png: null };

	readonly clipboard: ElectronHost['clipboard'] = {
		read: () => Promise.resolve({ ...this.clipboardContent }),
		write: (content) => {
			this.clipboardContent = {
				text: content.text === undefined ? null : content.text,
				html: content.html === undefined ? null : content.html,
				png: content.png === undefined ? null : content.png
			};
			return Promise.resolve();
		}
	};

	/** The last application menu template set; `null` before any. */
	applicationMenu: HostMenuItem[] | null = null;

	readonly menu: ElectronHost['menu'] = {
		setApplicationMenu: (items) => {
			this.applicationMenu = items;
		}
	};

	readonly screen: ElectronHost['screen'] = {
		workAreas: () => [...this.displays]
	};

	readonly userData: ElectronHost['userData'] = {
		readText: (name) => this.files.get(name),
		writeText: (name, text) => {
			this.files.set(name, text);
		}
	};

	readonly fonts: ElectronHost['fonts'] = {
		scan: () => {
			this.scanCount += 1;
			const files: HostFontFile[] = [];
			for (const [file, font] of this.installedFonts) {
				files.push({ family: font.family, style: font.style, file });
			}
			return Promise.resolve(files);
		},
		read: (file) => {
			this.readCount += 1;
			const font = this.installedFonts.get(file);
			if (!font) return Promise.reject(new Error(`ENOENT: ${file}`));
			return Promise.resolve(font.bytes);
		}
	};

	/** Plugin files by absolute path (directories are implied); tests edit them with `setPluginFile`. */
	readonly pluginTree = new Map<string, string>();
	readonly pluginDirectories = new Set<string>();
	readonly pluginWatchers = new Set<{ directory: string; onChange: () => void }>();

	readonly pluginFiles: ElectronHost['pluginFiles'] = {
		listDirectories: (directory) => {
			const names = new Set<string>();
			const prefix = `${directory}/`;
			for (const file of this.pluginTree.keys()) {
				if (!file.startsWith(prefix)) continue;
				const rest = file.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash > 0) names.add(rest.slice(0, slash));
			}
			return Promise.resolve([...names].sort(compareText));
		},
		readText: (file) => Promise.resolve(this.pluginTree.get(file)),
		ensureDirectory: (directory) => {
			this.pluginDirectories.add(directory);
			return Promise.resolve();
		},
		watch: (directory, onChange) => {
			const watcher = { directory, onChange };
			this.pluginWatchers.add(watcher);
			return () => {
				this.pluginWatchers.delete(watcher);
			};
		},
		install: (source, destination) => {
			const files = this.installable(source);
			if (files === undefined) return Promise.reject(new Error(`no plugin at ${source}`));
			for (const file of this.pluginTree.keys()) {
				if (file.startsWith(`${destination}/`)) {
					return Promise.reject(new Error(`"${destination}" already exists`));
				}
			}
			for (const [name, text] of Object.entries(files)) {
				this.setPluginFile(`${destination}/${name}`, text);
			}
			return Promise.resolve();
		},
		remove: (directory) => {
			for (const file of this.pluginTree.keys()) {
				if (file.startsWith(`${directory}/`)) this.setPluginFile(file, undefined);
			}
			return Promise.resolve();
		}
	};

	/** Archives tests can install, by path: file name to text. */
	readonly pluginArchives = new Map<string, Record<string, string>>();

	/** The files a folder or a registered archive holds, by relative path. */
	private installable(source: string): Record<string, string> | undefined {
		const archive = this.pluginArchives.get(source);
		if (archive !== undefined) return archive;
		const files: Record<string, string> = {};
		for (const [file, text] of this.pluginTree) {
			if (file.startsWith(`${source}/`)) files[file.slice(source.length + 1)] = text;
		}
		if (Object.keys(files).length === 0) return undefined;
		return files;
	}

	/** Test driver: create, edit or (with `undefined`) delete a plugin file; watchers above it fire. */
	setPluginFile(file: string, text: string | undefined): void {
		if (text === undefined) this.pluginTree.delete(file);
		else this.pluginTree.set(file, text);
		for (const watcher of Array.from(this.pluginWatchers)) {
			if (file.startsWith(`${watcher.directory}/`)) watcher.onChange();
		}
	}

	/** Scripted agents: tests set `agents.script` to play the model. */
	readonly agents = new ScriptedAgentHost(defaultFakeScript);

	createWindow = (options: WindowOptions): FakeWindow => {
		const window = new FakeWindow(this.nextWindowId, options, (closed) => {
			const position = this.openWindows.indexOf(closed);
			if (position >= 0) this.openWindows.splice(position, 1);
		});
		this.nextWindowId += 1;
		this.openWindows.push(window);
		return window;
	};

	windows = (): WindowHandle[] => [...this.openWindows];

	windowFromSender = (sender: SenderHandle): WindowHandle | null => {
		const found = this.openWindows.find((window) => window.sender.id === sender.id);
		if (!found) return null;
		return found;
	};

	// ---------- test drivers ----------

	emitAppEvent<Name extends AppEventName>(event: Name, ...args: Parameters<AppEvents[Name]>): void {
		for (const listener of Array.from(this.appListeners.get(event) ?? [])) {
			(listener as (...callArgs: unknown[]) => void)(...args);
		}
	}

	/** An invoke event from the first open window's top frame on the trusted origin. */
	trustedEvent(window: FakeWindow = this.openWindows[0]): IpcInvokeEvent {
		return { sender: window.sender, senderFrame: { url: TRUSTED_URL, parent: null } };
	}

	/** Calls the registered handler like `ipcRenderer.invoke` would. */
	invoke(channel: string, payload?: unknown, event?: IpcInvokeEvent): Promise<unknown> {
		const handler = this.handlers.get(channel);
		if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`));
		return Promise.resolve(handler(event === undefined ? this.trustedEvent() : event, payload));
	}

	/** Everything a plugin can leave behind in the host; equal before mount and after unmount. */
	snapshot(): Record<string, unknown> {
		const appListenerCounts: Record<string, number> = {};
		for (const [event, set] of [...this.appListeners.entries()].sort(compareEntries)) {
			if (set.size > 0) appListenerCounts[event] = set.size;
		}
		return {
			handlers: [...this.handlers.keys()].sort(compareText),
			appListeners: appListenerCounts,
			protocolSchemes: [...this.protocolHandlers.keys()].sort(compareText),
			pluginWatchers: [...this.pluginWatchers]
				.map((watcher) => watcher.directory)
				.sort(compareText),
			openWindows: this.openWindows.length,
			windowListeners: this.openWindows.map((window) => ({
				closed: window.listenerCount('closed'),
				close: window.listenerCount('close'),
				maximize: window.listenerCount('maximize'),
				unmaximize: window.listenerCount('unmaximize'),
				resize: window.listenerCount('resize'),
				move: window.listenerCount('move'),
				closeRequests: window.closeHandlerCount()
			}))
		};
	}
}
