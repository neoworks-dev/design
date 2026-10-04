// The contract between main, preload and renderer: the only API the renderer sees
// (`window.desktop`). Types only, plus the event channel whitelist; zod schemas for the payloads
// live in `schemas.ts` because the sandboxed preload must not import packages.
//
// To add an IPC domain: add its channels to `IpcContract`, its schemas to `schemas.ts`, its
// methods to `DesktopBridge` and `preload.ts`, and register the routes from a main plugin with
// `route()`.

// ---------- shared value types ----------

export type AppPathName = 'userData' | 'documents' | 'downloads' | 'temp' | 'home';

export interface FileFilter {
	name: string;
	extensions: string[];
}
export interface OpenFileOptions {
	title?: string;
	defaultPath?: string;
	filters?: FileFilter[];
	multiple?: boolean;
}
export interface SaveFileOptions {
	title?: string;
	defaultPath?: string;
	filters?: FileFilter[];
}

export interface BootFailure {
	plugin: string;
	message: string;
}
export interface BootPending {
	plugin: string;
	/** Injected services nobody provides. */
	missing: string[];
}
/** What a kernel boot did, per plugin. The main kernel forwards its report to the renderer. */
export interface BootReport {
	kernel: 'main' | 'renderer';
	loaded: string[];
	failed: BootFailure[];
	pending: BootPending[];
}

// ---------- errors ----------

export type IpcErrorCode =
	'INVALID_PAYLOAD' | 'FORBIDDEN_SENDER' | 'HANDLER_FAILED' | 'UNKNOWN_CHANNEL';

/** How errors cross the IPC boundary: serialised, never thrown across it. */
export interface IpcFailure {
	code: IpcErrorCode;
	message: string;
}
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcFailure };

// ---------- request/response channels ----------

export interface IpcContract {
	'window:minimize': { payload: void; result: void };
	'window:toggleMaximize': { payload: void; result: boolean };
	'window:close': { payload: void; result: void };
	'window:isMaximized': { payload: void; result: boolean };
	'app:version': { payload: void; result: string };
	'app:path': { payload: AppPathName; result: string };
	'app:quit': { payload: void; result: void };
	'app:bootReport': { payload: void; result: BootReport | null };
	'dialogs:openFile': { payload: OpenFileOptions | undefined; result: string[] | null };
	'dialogs:saveFile': { payload: SaveFileOptions | undefined; result: string | null };
}
export type IpcChannel = keyof IpcContract;

// ---------- main to renderer pushes ----------

export interface IpcEvents {
	'kernel:boot-report': BootReport;
	'window:maximized': boolean;
}
export type IpcEventChannel = keyof IpcEvents;

// The whitelist of push channels the preload exposes. The check below makes a channel missing
// from it a compile error.
export const EVENT_CHANNELS = ['kernel:boot-report', 'window:maximized'] as const;
type MissingEventChannels = Exclude<IpcEventChannel, (typeof EVENT_CHANNELS)[number]>;
export const eventChannelsAreExhaustive: MissingEventChannels extends never ? true : never = true;

// ---------- the bridge ----------

export interface DesktopBridge {
	window: {
		minimize(): Promise<void>;
		toggleMaximize(): Promise<boolean>;
		close(): Promise<void>;
		/** Whether the window is maximized now; `window:maximized` pushes the changes. */
		isMaximized(): Promise<boolean>;
	};
	app: {
		version(): Promise<string>;
		path(name: AppPathName): Promise<string>;
		quit(): Promise<void>;
		/** The main kernel's boot report; `null` until main finished booting. */
		bootReport(): Promise<BootReport | null>;
	};
	dialogs: {
		openFile(options?: OpenFileOptions): Promise<string[] | null>;
		saveFile(options?: SaveFileOptions): Promise<string | null>;
	};
	events: {
		/** Subscribe to a main-to-renderer push; the returned function unsubscribes. */
		on<Channel extends IpcEventChannel>(
			channel: Channel,
			listener: (payload: IpcEvents[Channel]) => void
		): () => void;
	};
	system: {
		platform: NodeJS.Platform;
		arch: string;
	};
}
