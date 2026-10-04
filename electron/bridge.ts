// The contract between main, preload and renderer: the only API the renderer sees
// (`window.desktop`). Types only, plus the event channel whitelist; zod schemas for the payloads
// live in `schemas.ts` because the sandboxed preload must not import packages.
//
// To add an IPC domain: add its channels to `IpcContract`, its schemas to `schemas.ts`, its
// methods to `DesktopBridge` and `preload.ts`, and register the routes from a main plugin with
// `route()`.

import type { DesignDocument, Transaction } from '../src/lib/document/types';

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

/** A font face by name; what documents reference (data-model §3). */
export interface FontRef {
	family: string;
	style: string;
}
/** What a design file says about itself (the `meta` table), without its nodes. */
export interface StoreInfo {
	path: string;
	documentId: string;
	name: string;
	schemaVersion: number;
	/** Milliseconds since the epoch. */
	createdAt: number;
	modifiedAt: number;
	/** The previous session left the file without closing it cleanly (crash or kill). */
	recovered: boolean;
	/** Edits were committed since the last Save (checkpoint), possibly in an earlier session. */
	unsaved: boolean;
	/** The file lives in the app's `untitled` directory: it has never been saved by the user. */
	untitled: boolean;
}
export interface LoadedDocument {
	info: StoreInfo;
	document: DesignDocument;
}
/** What persisting a batch of transactions cost, for the autosave status and tests. */
export interface CommitResult {
	/** Transactions applied (duplicates of already logged ones are not counted). */
	committed: number;
	/** Node and entity rows written. */
	documentRows: number;
}
export interface CreateStoreRequest {
	path: string;
	/** The document to write into the new file; a blank one when omitted. */
	document?: DesignDocument;
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
	'fonts:list': { payload: void; result: FontRef[] };
	'fonts:load': { payload: FontRef; result: Uint8Array | null };
	/** One open document file per window; these act on the sender's. */
	'store:open': { payload: { path: string }; result: StoreInfo };
	'store:create': { payload: CreateStoreRequest; result: StoreInfo };
	'store:load': { payload: void; result: LoadedDocument };
	'store:close': { payload: void; result: void };
	/** Persist committed transactions, in order, each as one SQLite transaction. */
	'store:commit': { payload: { transactions: Transaction[] }; result: CommitResult };
	/** Save: fold the WAL into the file and clear the unsaved marker. */
	'store:checkpoint': { payload: void; result: StoreInfo };
	/**
	 * A new empty document in a temporary file in the app's `untitled` directory. `null` when the
	 * user cancelled leaving an untitled document with edits.
	 */
	'files:newUntitled': { payload: void; result: LoadedDocument | null };
	/** Open a design file as this window's document and load it; `null` when cancelled as above. */
	'files:open': { payload: { path: string }; result: LoadedDocument | null };
	/** The native open dialog filtered to design files; `null` when cancelled. */
	'files:openDialog': { payload: void; result: string | null };
	/** The native save dialog for design files; `null` when cancelled. */
	'files:saveDialog': { payload: { suggestedName: string }; result: string | null };
	/** Copy the open file to `path` (replacing it) and continue editing the copy. */
	'files:saveAs': { payload: { path: string }; result: StoreInfo };
	/** Offer to restore an untitled document a crash left behind; `null` when none or declined. */
	'files:offerRecovery': { payload: void; result: LoadedDocument | null };
	/** The file this launch was asked to open (command line, OS), once; `null` otherwise. */
	'files:launchRequest': { payload: void; result: string | null };
	/** Answer to a `files:flush-request` push: the renderer's queue is persisted. */
	'files:flushed': { payload: { requestId: string }; result: void };
}
export type IpcChannel = keyof IpcContract;

// ---------- main to renderer pushes ----------

export interface IpcEvents {
	'kernel:boot-report': BootReport;
	'window:maximized': boolean;
	/** Main is about to close the file (window close, quit, Save As): persist what is queued. */
	'files:flush-request': { requestId: string };
	/** The OS asked this running instance to open a file (second launch, macOS open-file). */
	'files:open-request': { path: string };
}
export type IpcEventChannel = keyof IpcEvents;

// The whitelist of push channels the preload exposes. The check below makes a channel missing
// from it a compile error.
export const EVENT_CHANNELS = [
	'kernel:boot-report',
	'window:maximized',
	'files:flush-request',
	'files:open-request'
] as const;
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
	fonts: {
		/** Installed font faces, sorted by family then style. */
		list(): Promise<FontRef[]>;
		/** The font file's bytes, or `null` when no installed face has that family and style. */
		load(ref: FontRef): Promise<Uint8Array | null>;
	};
	store: {
		/** Open an existing design file as this window's document. */
		open(path: string): Promise<StoreInfo>;
		/** Create a new design file (blank unless a document is given) and open it. */
		create(request: CreateStoreRequest): Promise<StoreInfo>;
		/** The whole document of the open file. */
		load(): Promise<LoadedDocument>;
		close(): Promise<void>;
		/** Persist committed document transactions, oldest first. */
		commit(transactions: Transaction[]): Promise<CommitResult>;
		/** Save: checkpoint the file and clear its unsaved marker. */
		checkpoint(): Promise<StoreInfo>;
	};
	files: {
		newUntitled(): Promise<LoadedDocument | null>;
		open(path: string): Promise<LoadedDocument | null>;
		openDialog(): Promise<string | null>;
		saveDialog(suggestedName: string): Promise<string | null>;
		saveAs(path: string): Promise<StoreInfo>;
		offerRecovery(): Promise<LoadedDocument | null>;
		launchRequest(): Promise<string | null>;
		flushed(requestId: string): Promise<void>;
		/** The path of a file dropped on the window (Electron no longer exposes `File.path`). */
		pathForFile(file: File): string;
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
