// In-memory DesktopBridge for `bun run dev` in a plain browser and for tests, so renderer work does
// not need Electron. Nothing here touches the disk or the OS: dialogs resolve as cancelled and
// window controls only keep a flag. `emit` lets a test play the part of the main process.

import type {
	AppPathName,
	BootReport,
	ClipboardContent,
	DesktopBridge,
	IpcEventChannel,
	IpcEvents,
	SettingsData
} from '../../../electron/bridge';

export interface BrowserBridge extends DesktopBridge {
	/** Push an event to the current subscribers, like main's `emitTo`. */
	emit<Channel extends IpcEventChannel>(channel: Channel, payload: IpcEvents[Channel]): void;
	/** Total subscribers across channels; 0 once every subscription was unwound. */
	subscriberCount(): number;
}

const BROWSER_VERSION = '0.0.0-browser';

function browserPlatform(): NodeJS.Platform {
	if (typeof navigator === 'undefined') return 'linux';
	const text = navigator.userAgent.toLowerCase();
	if (text.includes('mac')) return 'darwin';
	if (text.includes('win')) return 'win32';
	return 'linux';
}

function unavailable(what: string): Promise<never> {
	return Promise.reject(new Error(`${what} needs the desktop app (this is a plain browser)`));
}

export function createBrowserBridge(): BrowserBridge {
	const listeners = new Map<IpcEventChannel, Set<(payload: never) => void>>();
	let maximized = false;
	// The browser has no OS clipboard access here: copies stay inside the page.
	let clipboard: ClipboardContent = { text: null, html: null, png: null };
	// Preferences live in memory in a plain browser; the desktop app writes them to disk.
	let settings: SettingsData = { core: {}, plugins: {} };
	const report: BootReport = { kernel: 'main', loaded: [], failed: [], pending: [] };

	return {
		window: {
			minimize: () => Promise.resolve(),
			toggleMaximize: () => {
				maximized = !maximized;
				return Promise.resolve(maximized);
			},
			close: () => Promise.resolve(),
			isMaximized: () => Promise.resolve(maximized)
		},
		app: {
			version: () => Promise.resolve(BROWSER_VERSION),
			path: (name: AppPathName) => Promise.resolve(`/browser/${name}`),
			quit: () => Promise.resolve(),
			bootReport: () => Promise.resolve(report)
		},
		diagnostics: {
			read: () =>
				Promise.resolve({
					app: {
						version: BROWSER_VERSION,
						electron: 'none',
						chrome: 'browser',
						platform: 'browser',
						arch: 'unknown',
						safeMode: false
					},
					main: [],
					renderer: []
				}),
			restart: () => Promise.resolve()
		},
		dialogs: {
			openFile: () => Promise.resolve(null),
			saveFile: () => Promise.resolve(null),
			openImages: () => Promise.resolve(null)
		},
		exports: { write: () => Promise.resolve(null) },
		archive: {
			export: () => Promise.resolve(null),
			read: () => Promise.resolve(null),
			createFile: () => Promise.resolve(null)
		},
		clipboard: {
			read: () => Promise.resolve({ ...clipboard }),
			write: (content) => {
				clipboard = {
					text: content.text === undefined ? null : content.text,
					html: content.html === undefined ? null : content.html,
					png: content.png === undefined ? null : content.png
				};
				return Promise.resolve();
			}
		},
		menu: { set: () => Promise.resolve() },
		fonts: {
			list: () => Promise.resolve([]),
			load: () => Promise.resolve(null)
		},
		store: {
			open: () => unavailable('opening files'),
			create: () => unavailable('creating files'),
			load: () => unavailable('loading files'),
			close: () => Promise.resolve(),
			commit: () => unavailable('saving files'),
			checkpoint: () => unavailable('saving files')
		},
		versions: {
			list: () => unavailable('version history'),
			add: () => unavailable('version history'),
			remove: () => unavailable('version history'),
			restorePlan: () => unavailable('version history')
		},
		ai: {
			providers: () => Promise.resolve([]),
			start: () => unavailable('the AI agent'),
			send: () => unavailable('the AI agent'),
			cancel: () => Promise.resolve(),
			end: () => Promise.resolve(),
			toolResult: () => Promise.resolve()
		},
		settings: {
			load: () => Promise.resolve(structuredClone(settings)),
			save: (data) => {
				settings = structuredClone(data);
				return Promise.resolve();
			}
		},
		assets: {
			put: () => unavailable('storing images'),
			get: () => Promise.resolve(null),
			collect: () => Promise.resolve([]),
			embedFont: () => unavailable('embedding fonts'),
			fontBytes: () => Promise.resolve(null),
			embeddedFonts: () => Promise.resolve([])
		},
		files: {
			openInTab: () => unavailable('opening files'),
			newInTab: () => unavailable('creating documents'),
			confirmClose: () => Promise.resolve(true),
			discard: () => Promise.resolve(),
			newUntitled: () => unavailable('creating documents'),
			open: () => unavailable('opening files'),
			openDialog: () => Promise.resolve(null),
			saveDialog: () => Promise.resolve(null),
			saveAs: () => unavailable('saving files'),
			offerRecovery: () => Promise.resolve(null),
			launchRequest: () => Promise.resolve(null),
			recent: () => Promise.resolve([]),
			drafts: () => Promise.resolve([]),
			removeRecent: () => Promise.resolve(),
			reveal: () => Promise.resolve(),
			clearRecent: () => Promise.resolve(),
			setThumbnail: () => Promise.resolve(),
			flushed: () => Promise.resolve(),
			pathForFile: () => ''
		},
		plugins: {
			list: () => Promise.resolve({ plugins: [], project: null, projectTrust: null }),
			setTrust: () => unavailable('trusting a project'),
			readFile: () => unavailable('reading plugin files'),
			install: () => unavailable('installing plugins'),
			create: () => unavailable('creating plugins'),
			installFromDialog: () => Promise.resolve(null),
			remove: () => unavailable('removing plugins'),
			reveal: () => unavailable('showing plugin folders'),
			permissions: () => Promise.resolve({}),
			setPermission: () => unavailable('changing plugin permissions'),
			fetch: () => unavailable('plugin network access'),
			storageGet: () => Promise.resolve(null),
			storageSet: () => unavailable('plugin storage'),
			storageDelete: () => unavailable('plugin storage'),
			storageKeys: () => Promise.resolve([])
		},
		events: {
			on: (channel, listener) => {
				const set = listeners.get(channel) ?? new Set<(payload: never) => void>();
				set.add(listener);
				listeners.set(channel, set);
				return () => {
					set.delete(listener);
				};
			}
		},
		system: { platform: browserPlatform(), arch: 'browser' },
		emit: (channel, payload) => {
			for (const listener of Array.from(listeners.get(channel) ?? [])) {
				(listener as (value: typeof payload) => void)(payload);
			}
		},
		subscriberCount: () => {
			let total = 0;
			for (const set of listeners.values()) total += set.size;
			return total;
		}
	};
}
