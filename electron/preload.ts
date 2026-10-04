import { contextBridge, ipcRenderer } from 'electron';
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
		close: () => invoke('window:close')
	},
	app: {
		version: () => invoke('app:version'),
		path: (name) => invoke('app:path', name),
		quit: () => invoke('app:quit'),
		bootReport: () => invoke('app:bootReport')
	},
	dialogs: {
		openFile: (options) => invoke('dialogs:openFile', options),
		saveFile: (options) => invoke('dialogs:saveFile', options)
	},
	events: { on: subscribe },
	system: {
		platform: process.platform,
		arch: process.arch
	}
};

contextBridge.exposeInMainWorld('desktop', bridge);
