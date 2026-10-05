import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
	EVENT_CHANNELS,
	type DesktopBridge,
	type IpcChannel,
	type IpcContract,
	type IpcEventChannel,
	type IpcEvents,
	type IpcFailure,
	type IpcResult
} from './bridge';

// The single API surface the renderer sees. The renderer never touches Node or ipcRenderer
// directly, and only the channels named here (request channels typed by `IpcContract`, push
// channels whitelisted in `EVENT_CHANNELS`) are reachable. This file is sandboxed: it may import
// `electron` and local files, never packages.

/** Errors cross the context bridge as plain Errors; the code is kept on the error and in its name. */
function toError(failure: IpcFailure): Error {
	const error = new Error(`${failure.code}: ${failure.message}`);
	error.name = failure.code;
	return Object.assign(error, { code: failure.code });
}

async function invoke<Channel extends IpcChannel>(
	channel: Channel,
	payload?: IpcContract[Channel]['payload']
): Promise<IpcContract[Channel]['result']> {
	const result: IpcResult<IpcContract[Channel]['result']> = await ipcRenderer.invoke(
		channel,
		payload
	);
	if (result.ok) return result.value;
	throw toError(result.error);
}

function subscribe<Channel extends IpcEventChannel>(
	channel: Channel,
	listener: (payload: IpcEvents[Channel]) => void
): () => void {
	if (!EVENT_CHANNELS.includes(channel)) throw new Error(`unknown event channel: ${channel}`);
	const forward = (_event: unknown, payload: IpcEvents[Channel]): void => listener(payload);
	ipcRenderer.on(channel, forward);
	return () => {
		ipcRenderer.removeListener(channel, forward);
	};
}

const bridge: DesktopBridge = {
	window: {
		minimize: () => invoke('window:minimize'),
		toggleMaximize: () => invoke('window:toggleMaximize'),
		close: () => invoke('window:close'),
		isMaximized: () => invoke('window:isMaximized')
	},
	app: {
		version: () => invoke('app:version'),
		path: (name) => invoke('app:path', name),
		quit: () => invoke('app:quit'),
		bootReport: () => invoke('app:bootReport')
	},
	diagnostics: {
		read: () => invoke('diagnostics:read'),
		restart: (safeMode) => invoke('diagnostics:restart', { safeMode })
	},
	dialogs: {
		openFile: (options) => invoke('dialogs:openFile', options),
		saveFile: (options) => invoke('dialogs:saveFile', options),
		openImages: () => invoke('dialogs:openImages')
	},
	exports: {
		write: (files) => invoke('exports:write', { files })
	},
	archive: {
		export: (suggestedName, entries) => invoke('archive:export', { suggestedName, entries }),
		read: () => invoke('archive:read'),
		createFile: (request) => invoke('archive:create', request)
	},
	clipboard: {
		read: () => invoke('clipboard:read'),
		write: (content) => invoke('clipboard:write', content)
	},
	menu: {
		set: (items) => invoke('menu:set', items)
	},
	fonts: {
		list: () => invoke('fonts:list'),
		load: (ref) => invoke('fonts:load', ref)
	},
	store: {
		open: (path) => invoke('store:open', { path }),
		create: (request) => invoke('store:create', request),
		load: () => invoke('store:load'),
		close: () => invoke('store:close'),
		commit: (transactions) => invoke('store:commit', { transactions }),
		checkpoint: () => invoke('store:checkpoint')
	},
	ai: {
		providers: () => invoke('ai:providers'),
		start: (request) => invoke('ai:start', request),
		send: (request) => invoke('ai:send', request),
		cancel: (sessionId) => invoke('ai:cancel', { sessionId }),
		end: (sessionId) => invoke('ai:end', { sessionId }),
		toolResult: (result) => invoke('ai:toolResult', result)
	},
	versions: {
		list: () => invoke('versions:list'),
		add: (name) => invoke('versions:add', { name }),
		remove: (id) => invoke('versions:remove', { id }),
		restorePlan: (seq) => invoke('versions:restorePlan', { seq })
	},
	settings: {
		load: () => invoke('settings:load'),
		save: (data) => invoke('settings:save', data)
	},
	assets: {
		put: (request) => invoke('assets:put', request),
		get: (hash) => invoke('assets:get', { hash }),
		collect: () => invoke('assets:collect'),
		embedFont: (ref, bytes) => invoke('assets:embedFont', { ...ref, bytes }),
		fontBytes: (ref) => invoke('assets:fontBytes', ref),
		embeddedFonts: () => invoke('assets:embeddedFonts')
	},
	files: {
		openInTab: (path) => invoke('files:openInTab', { path }),
		newInTab: () => invoke('files:newInTab'),
		confirmClose: () => invoke('files:confirmClose'),
		discard: (path) => invoke('files:discard', { path }),
		newUntitled: () => invoke('files:newUntitled'),
		open: (path) => invoke('files:open', { path }),
		openDialog: () => invoke('files:openDialog'),
		saveDialog: (suggestedName) => invoke('files:saveDialog', { suggestedName }),
		saveAs: (path) => invoke('files:saveAs', { path }),
		offerRecovery: () => invoke('files:offerRecovery'),
		launchRequest: () => invoke('files:launchRequest'),
		recent: () => invoke('files:recent'),
		drafts: () => invoke('files:drafts'),
		removeRecent: (path) => invoke('files:removeRecent', { path }),
		reveal: (path) => invoke('files:reveal', { path }),
		clearRecent: () => invoke('files:clearRecent'),
		setThumbnail: (thumbnail) => invoke('files:setThumbnail', thumbnail),
		flushed: (requestId) => invoke('files:flushed', { requestId }),
		pathForFile: (file) => webUtils.getPathForFile(file)
	},
	events: { on: subscribe },
	system: {
		platform: process.platform,
		arch: process.arch
	}
};

contextBridge.exposeInMainWorld('desktop', bridge);
