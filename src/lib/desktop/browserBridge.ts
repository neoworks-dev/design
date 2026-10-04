// In-memory DesktopBridge for `bun run dev` in a plain browser and for tests, so renderer work does
// not need Electron. Nothing here touches the disk or the OS: dialogs resolve as cancelled and
// window controls only keep a flag. `emit` lets a test play the part of the main process.

import type {
	AppPathName,
	BootReport,
	DesktopBridge,
	IpcEventChannel,
	IpcEvents
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
		dialogs: {
			openFile: () => Promise.resolve(null),
			saveFile: () => Promise.resolve(null)
		},
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
		files: {
			newUntitled: () => unavailable('creating documents'),
			open: () => unavailable('opening files'),
			openDialog: () => Promise.resolve(null),
			saveDialog: () => Promise.resolve(null),
			saveAs: () => unavailable('saving files'),
			offerRecovery: () => Promise.resolve(null),
			launchRequest: () => Promise.resolve(null),
			flushed: () => Promise.resolve(),
			pathForFile: () => ''
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
