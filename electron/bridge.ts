// The contract between main, preload and renderer: the only API the renderer sees
// (`window.desktop`). Types only, plus the event channel whitelist; zod schemas for the payloads
// live in `schemas.ts` because the sandboxed preload must not import packages.
//
// To add an IPC domain: add its channels to `IpcContract`, its schemas to `schemas.ts`, its
// methods to `DesktopBridge` and `preload.ts`, and register the routes from a main plugin with
// `route()`.

import type { AssetRecord, Change, DesignDocument, Transaction } from '../src/lib/document/types';

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
	/** The file lives in the Draftboard library (root or one of its folders), not elsewhere. */
	inLibrary: boolean;
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

/** What made a version mark: the user (named), a Save, or opening the file. */
export type VersionKind = 'named' | 'save' | 'session';
/** A position in the transaction log with a name: the state after the transaction `seq`. */
export interface VersionMark {
	id: string;
	name: string;
	kind: VersionKind;
	seq: number;
	/** Milliseconds since the epoch. */
	createdAt: number;
}
/** One logged transaction, without its changes, for the history list. */
export interface LogEntrySummary {
	seq: number;
	id: string;
	/** Milliseconds since the epoch. */
	createdAt: number;
	/** `user`, `plugin`, `ai` or `sync`. */
	origin: string;
	label: string;
}
export interface VersionHistoryData {
	/** Position of the newest logged transaction (survives pruning); 0 before the first. */
	latestSeq: number;
	/** Position of the oldest transaction still logged; `latestSeq + 1` when the log is empty. */
	oldestSeq: number;
	marks: VersionMark[];
	/** The newest entries, oldest first. */
	entries: LogEntrySummary[];
}
/** What undoing everything after a position takes; `available` is false once it was pruned. */
export interface RestorePlan {
	available: boolean;
	/** One change list that undoes the transactions after the position, newest first. */
	changes: Change[];
	/** Transactions it undoes. */
	count: number;
	latestSeq: number;
}

/** An encoded preview image, as stored in a file's `thumbnails` table. */
export interface Thumbnail {
	mime: string;
	width: number;
	height: number;
	bytes: Uint8Array;
}
// ---------- the library ----------
//
// The library is a directory Draftboard owns: `$XDG_DATA_HOME/draftboard/` on Linux
// (`~/.local/share/draftboard/`), `Documents/Draftboard/` elsewhere, overridable with
// `DRAFTBOARD_LIBRARY_DIR` (QA and tests). Files directly in it are the "Drafts"; its
// subdirectories are folders (one level). Linked folders are directories elsewhere on disk (a git
// repo shared with a team, ...) whose `.ndesign` files are listed the same way. Every directory
// the routes below accept is the library root, a library folder, a linked folder or a direct
// subdirectory of a linked folder; main rejects anything else.

/** Where a listed file lives. */
export type FileLocation =
	| { kind: 'library'; /** Folder name, `''` for the library root (Drafts). */ folder: string }
	| { kind: 'linked'; linkedId: string; /** Path relative to the linked folder, `''` at its top. */ folder: string }
	/** Neither: a file opened from somewhere else, known only through the recent list. */
	| { kind: 'external' };

/** A design file as the home screen lists it. */
export interface LibraryFile {
	path: string;
	/** File name without `.ndesign`; renaming a file renames it on disk. */
	name: string;
	/** File modification time, milliseconds since the epoch ("Edited 3 days ago"). */
	modifiedAt: number;
	/** When it was last opened in Draftboard; `null` when never (or forgotten). */
	openedAt: number | null;
	location: FileLocation;
	/** The file's `file` thumbnail; `null` until the renderer wrote one. */
	thumbnail: Thumbnail | null;
}

/** A directory that holds design files: a library folder or a subdirectory of a linked folder. */
export interface LibraryFolder {
	path: string;
	name: string;
	fileCount: number;
	modifiedAt: number;
}

/** A directory outside the library the user added to the sidebar. */
export interface LinkedFolder {
	id: string;
	/** The directory's base name unless the user renamed the entry. */
	name: string;
	path: string;
	/** `false` while the directory is missing (unplugged drive, deleted repo). */
	available: boolean;
}

/** Everything the home screen's sidebar needs. */
export interface LibraryOverview {
	/** Absolute path of the library root. */
	root: string;
	/** Library folders, by name. */
	folders: LibraryFolder[];
	linked: LinkedFolder[];
}

/** One directory's contents: its subfolders and the design files directly in it. */
export interface DirectoryListing {
	directory: string;
	folders: LibraryFolder[];
	files: LibraryFile[];
}

/** Pushed when a file the app knows was renamed, moved or trashed (by this or another window). */
export interface FileMovedMessage {
	from: string;
	/** `null` when it went to the trash. */
	to: string | null;
}

/** An image file the user picked in the native dialog, read by main. */
export interface PickedImage {
	/** File name with extension, for naming the layer. */
	name: string;
	bytes: Uint8Array;
}

/** An image to store in the open file's `assets` table. */
export interface AssetPutRequest {
	mime: string;
	bytes: Uint8Array;
	/** Pixel size after EXIF orientation, when the sender could read it. */
	width?: number;
	height?: number;
}
export interface AssetPutResult {
	/** The record to add to the document's `assets` (hash is its `id`). */
	record: AssetRecord;
	/** False when the same bytes were already stored. */
	created: boolean;
}

/** One file of an export, written by main under its name. */
export interface ExportFileData {
	/** A file name; directories are stripped by main. */
	name: string;
	bytes: Uint8Array;
}

/** One file of a design archive (a zip of JSON): a relative path and its bytes. */
export interface ArchiveEntry {
	path: string;
	bytes: Uint8Array;
}
/** An image to store in a file created from an archive; its hash must match its bytes. */
export interface ArchiveImageData {
	hash: string;
	mime: string;
	width?: number;
	height?: number;
	bytes: Uint8Array;
}
export interface CreateFromArchiveRequest {
	document: DesignDocument;
	images: ArchiveImageData[];
	fonts: Array<FontRef & { bytes: Uint8Array }>;
}

/** What the OS clipboard holds, as far as the app reads it. Absent kinds are `null`. */
export interface ClipboardContent {
	text: string | null;
	html: string | null;
	/** An image, encoded as PNG. */
	png: Uint8Array | null;
}
/** What to put on the OS clipboard; every kind given is written together, replacing the rest. */
export interface ClipboardWrite {
	text?: string;
	html?: string;
	png?: Uint8Array;
}

/**
 * Everything the user changed in Settings. `core` holds the app's own keys (bare names),
 * `plugins` one object per plugin id with that plugin's `Config` overrides.
 */
export interface SettingsData {
	core: Record<string, unknown>;
	plugins: Record<string, Record<string, unknown>>;
}

/**
 * One entry of the native application menu, mirrored from the renderer's `menus` registry. A
 * click runs `command` in the renderer (`menu:command`); `accelerator` is shown, the renderer's
 * keymap still receives the key press.
 */
export interface NativeMenuItem {
	label: string;
	/** Electron accelerator syntax, for example `CommandOrControl+K`. */
	accelerator?: string;
	enabled: boolean;
	checked: boolean;
	/** Command to run in the renderer; absent for submenu parents. */
	command?: string;
	args?: unknown;
	separatorBefore: boolean;
	submenu?: NativeMenuItem[];
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

/** What "copy diagnostics" and the log viewer show; assembled by main (`diagnostics:read`). */
export interface DiagnosticsReport {
	app: {
		version: string;
		electron: string;
		chrome: string;
		platform: string;
		arch: string;
		/** The window was loaded with only the core plugins. */
		safeMode: boolean;
	};
	/** The newest lines the main kernel logged, oldest first. */
	main: string[];
	/** The newest lines the renderer wrote to its console, oldest first. */
	renderer: string[];
}

// ---------- AI (main-ai, renderer `ai` service) ----------

/** One tool the agent may call, as the renderer's `ai-tools` plugin describes it. */
export interface AiToolDefinition {
	name: string;
	description: string;
	/** JSON Schema of the arguments (an object schema). */
	inputSchema: Record<string, unknown>;
	/** True for tools that change the document; read-only runs hide them. */
	write: boolean;
}
export interface AiModelInfo {
	id: string;
	name: string;
}
/** A harness the user can pick. Credentials never appear here: they stay in main. */
export interface AiProviderInfo {
	id: string;
	label: string;
	available: boolean;
	detail?: string;
	models: AiModelInfo[];
}
export interface AiStartRequest {
	provider: string;
	model?: string;
	system: string;
	tools: AiToolDefinition[];
}
export interface AiSendRequest {
	sessionId: string;
	/** The renderer's id for this turn; events and tool calls carry it back. */
	runId: string;
	prompt: string;
}
export type AiToolStatus = 'running' | 'done' | 'failed';
/** What an agent turn streams: text, reasoning, tool calls, then exactly one `done` or `error`. */
export type AiStreamEvent =
	| { type: 'text'; text: string }
	| { type: 'thought'; text: string }
	| { type: 'tool_call'; callId: string; name: string; input?: unknown; status: AiToolStatus }
	| { type: 'error'; message: string }
	| { type: 'done'; stopReason: string };
export interface AiEventMessage {
	sessionId: string;
	runId: string;
	event: AiStreamEvent;
}
/** Main asks the renderer to run a document tool; the renderer answers with `ai:toolResult`. */
export interface AiToolCallMessage {
	sessionId: string;
	runId: string;
	callId: string;
	tool: string;
	input: unknown;
}
export interface AiToolResultMessage {
	callId: string;
	ok: boolean;
	/** What the model sees: JSON or a readable error. */
	text: string;
}

// ---------- third-party plugins (main-plugins) ----------

/** Where a plugin was found: bundled with the app, in the user data directory, or in a project. */
export type PluginSourceKind = 'builtin' | 'user' | 'project';

/**
 * A plugin directory as main found it. The manifest is parsed JSON, not validated: the renderer's
 * `plugin-manifests` plugin owns the schema and reports path-level errors.
 */
export interface DiscoveredPlugin {
	source: PluginSourceKind;
	/** Name of the plugin's directory; with `source` it addresses the plugin in `plugins:readFile`. */
	directoryName: string;
	directory: string;
	/** The parsed `manifest.json`; `null` when the file is missing or not JSON (see `error`). */
	manifest: unknown;
	error?: string;
	/** Project plugins are untrusted until the user trusts the project; the others always are. */
	trusted: boolean;
}

export type ProjectTrust = 'trusted' | 'untrusted' | 'undecided';

/** What one window sees: the plugins of its three roots, and the project they were read for. */
export interface PluginList {
	plugins: DiscoveredPlugin[];
	/** The project directory (the open document's folder); `null` for untitled documents. */
	project: string | null;
	/** The stored decision for `project`; `null` when there is no project. */
	projectTrust: ProjectTrust | null;
}

/** A plugin's files changed on disk (and its `build` command ran, when it has one). */
export interface PluginReloadMessage {
	source: PluginSourceKind;
	directoryName: string;
	/** The result of the manifest's `build` command; absent when the plugin has none. */
	build?: { ok: boolean; output: string };
}

/** A user's decisions on what plugins may do: by plugin id, permission to granted (true) or denied. */
export type PluginPermissionDecisions = Record<string, Record<string, boolean>>;

export interface PluginFetchRequest {
	pluginId: string;
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

export interface PluginFetchResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
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
	'diagnostics:read': { payload: void; result: DiagnosticsReport };
	/** Load the window again, in safe mode (core plugins only) or normally. */
	'diagnostics:restart': { payload: { safeMode: boolean }; result: void };
	'dialogs:openFile': { payload: OpenFileOptions | undefined; result: string[] | null };
	'dialogs:saveFile': { payload: SaveFileOptions | undefined; result: string | null };
	/** The native open dialog filtered to images (several allowed); main reads the files. */
	'dialogs:openImages': { payload: void; result: PickedImage[] | null };
	/**
	 * Write exported files: one file asks for its path in the native save dialog, several ask for
	 * a folder. Resolves with the written paths; `null` when the user cancelled (nothing written).
	 */
	'exports:write': { payload: { files: ExportFileData[] }; result: string[] | null };
	/** Zip `entries` and write them where the native save dialog says; `null` when cancelled. */
	'archive:export': {
		payload: { suggestedName: string; entries: ArchiveEntry[] };
		result: string | null;
	};
	/** The native open dialog for a design archive; main unzips it. `null` when cancelled. */
	'archive:read': { payload: void; result: { path: string; entries: ArchiveEntry[] } | null };
	/**
	 * Create a design file from an imported archive at a path the native save dialog gives
	 * (without opening it). The path, or `null` when cancelled.
	 */
	'archive:create': { payload: CreateFromArchiveRequest; result: string | null };
	'clipboard:read': { payload: void; result: ClipboardContent };
	'clipboard:write': { payload: ClipboardWrite; result: void };
	/** Replace the native application menu with the renderer's resolved menu bar. */
	'menu:set': { payload: NativeMenuItem[]; result: void };
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
	/** Version history of the open file: marks and the newest log entries. */
	'versions:list': { payload: void; result: VersionHistoryData };
	/** Mark the current end of the log with a name. */
	'versions:add': { payload: { name: string }; result: VersionMark };
	'versions:remove': { payload: { id: string }; result: void };
	/** The changes that undo everything logged after `seq` (see `RestorePlan`). */
	'versions:restorePlan': { payload: { seq: number }; result: RestorePlan };
	/**
	 * A new empty document, created on disk right away as `Untitled.ndesign` (`Untitled 2`, ... when
	 * taken) in `directory` (default: the library root), and made the window's document. Nothing
	 * ever asks to save: every change is autosaved. Flushes the renderer's queue for the previous
	 * document first; that one is left alone (it may stay a background tab).
	 */
	'files:new': { payload: { directory?: string }; result: LoadedDocument };
	/** Open a design file as the window's document (flushing the previous one first, as above). */
	'files:open': { payload: { path: string }; result: LoadedDocument };
	/** The native open dialog filtered to design files; `null` when cancelled. */
	'files:openDialog': { payload: void; result: string | null };
	/** The native save dialog for design files; `null` when cancelled. */
	'files:saveDialog': { payload: { suggestedName: string }; result: string | null };
	/** "Save a copy as": copy the open file to `path` (replacing it) and continue editing the copy. */
	'files:saveAs': { payload: { path: string }; result: StoreInfo };
	/** The file this launch was asked to open (command line, OS), once; `null` otherwise. */
	'files:launchRequest': { payload: void; result: string | null };
	/** Recently opened documents, newest first; files that vanished are pruned here. */
	'files:recent': { payload: void; result: LibraryFile[] };
	/** Drop one file from the recent list; the file itself stays. */
	'files:removeRecent': { payload: { path: string }; result: void };
	/** Show a file in the OS file manager. */
	'files:reveal': { payload: { path: string }; result: void };
	/** Forget every recent document (also the OS's list where it has one). */
	'files:clearRecent': { payload: void; result: void };
	/** Store the open file's thumbnail (key `file`) so the recent list can show it. */
	'files:setThumbnail': { payload: Thumbnail; result: void };
	/** The library root, its folders and the linked folders. */
	'library:overview': { payload: void; result: LibraryOverview };
	/** Subfolders and design files directly in `directory` (see the library section above). */
	'library:list': { payload: { directory: string }; result: DirectoryListing };
	/** Design files whose name contains `query` (case-insensitive) in the library and linked folders. */
	'library:search': { payload: { query: string }; result: LibraryFile[] };
	/** Make a folder in `parent` (library root or a linked folder); a taken name gets ` 2`, ... */
	'library:createFolder': { payload: { parent: string; name: string }; result: LibraryFolder };
	/** Rename a folder on disk; open documents inside follow (`files:moved` is pushed per file). */
	'library:renameFolder': { payload: { path: string; name: string }; result: LibraryFolder };
	/** Move a folder and everything in it to the OS trash. */
	'library:trashFolder': { payload: { path: string }; result: void };
	/** Rename a design file on disk (and its document name). Works on the open document too. */
	'library:renameFile': { payload: { path: string; name: string }; result: LibraryFile };
	/** Move a design file into `directory`; a taken name gets ` 2`, ... Works on the open document. */
	'library:moveFile': { payload: { path: string; directory: string }; result: LibraryFile };
	/** Copy a design file next to itself as `<name> copy`. */
	'library:duplicateFile': { payload: { path: string }; result: LibraryFile };
	/** Move a design file to the OS trash (closed first when a window has it open). */
	'library:trashFile': { payload: { path: string }; result: void };
	/** Pick a directory in the native dialog and add it as a linked folder; `null` when cancelled. */
	'library:linkFolder': { payload: void; result: LinkedFolder | null };
	/** Remove a linked folder from the sidebar; the directory itself stays. */
	'library:unlinkFolder': { payload: { id: string }; result: void };
	/** The stored preferences; an empty object pair when none were saved yet. */
	'settings:load': { payload: void; result: SettingsData };
	/** Replace the stored preferences; written to disk atomically. */
	'settings:save': { payload: SettingsData; result: void };
	/** Store image bytes by sha-256 in the open file; the same bytes are stored once. */
	'assets:put': { payload: AssetPutRequest; result: AssetPutResult };
	/** The bytes of a stored image; `null` when the file has none under that hash. */
	'assets:get': { payload: { hash: string }; result: Uint8Array | null };
	/** Delete stored images nothing references (also done at every Save); the removed hashes. */
	'assets:collect': { payload: void; result: string[] };
	/** Embed a font file in the open file (its `fonts` table). */
	'assets:embedFont': { payload: FontRef & { bytes: Uint8Array }; result: void };
	'assets:fontBytes': { payload: FontRef; result: Uint8Array | null };
	/** Faces the open file carries bytes for. */
	'assets:embeddedFonts': { payload: void; result: FontRef[] };
	/** Answer to a `files:flush-request` push: the renderer's queue is persisted. */
	'files:flushed': { payload: { requestId: string }; result: void };
	/** Harnesses main can drive and the models they offer (no secrets). */
	'ai:providers': { payload: void; result: AiProviderInfo[] };
	/** Start an agent session owned by the sender's window. */
	'ai:start': { payload: AiStartRequest; result: { sessionId: string } };
	/** Start a turn; its events stream back as `ai:event`. Rejects while a turn is running. */
	'ai:send': { payload: AiSendRequest; result: void };
	/** Stop the running turn (pending tool calls fail, the session stays usable). */
	'ai:cancel': { payload: { sessionId: string }; result: void };
	/** End the session and release the harness. */
	'ai:end': { payload: { sessionId: string }; result: void };
	/** The answer to an `ai:tool-call` push. */
	'ai:toolResult': { payload: AiToolResultMessage; result: void };
	/** Third-party plugins found in the three roots for the sender's window. */
	'plugins:list': { payload: void; result: PluginList };
	/** Trust (or distrust) the sender's project and its plugins; answers the new list. */
	'plugins:setTrust': { payload: { trusted: boolean }; result: PluginList };
	/** A file inside a plugin's directory as text (its `main` module). Untrusted plugins refuse. */
	'plugins:readFile': {
		payload: { source: PluginSourceKind; directoryName: string; file: string };
		result: string;
	};
	/** Copy a plugin folder, or unpack a plugin `.zip`, into the user plugins directory. */
	'plugins:install': { payload: { path: string }; result: PluginList };
	/** Ask for a plugin folder or `.zip` with a native dialog and install it; `null` when cancelled. */
	'plugins:installFromDialog': { payload: { kind: 'folder' | 'zip' }; result: PluginList | null };
	/** Write a new plugin from a template into the user plugins directory. */
	'plugins:create': {
		payload: { id: string; name: string; template: 'blank' | 'panel' | 'figma' };
		result: PluginList;
	};
	/** Delete an installed plugin of the user plugins directory. */
	'plugins:remove': { payload: { directoryName: string }; result: PluginList };
	/** Show a plugin's folder in the OS file manager. */
	'plugins:reveal': {
		payload: { source: PluginSourceKind; directoryName: string };
		result: void;
	};
	/** What the user allowed or denied each plugin of the sender's window (project plugins per project). */
	'plugins:permissions': { payload: void; result: PluginPermissionDecisions };
	/** Allow (`true`), deny (`false`) or forget (`null`) one permission of a plugin. */
	'plugins:setPermission': {
		payload: { pluginId: string; permission: string; granted: boolean | null };
		result: PluginPermissionDecisions;
	};
	/** An HTTP request on behalf of a plugin; refused unless it may use `network` and the host is allowed. */
	'plugins:fetch': { payload: PluginFetchRequest; result: PluginFetchResponse };
	/** `clientStorage` of a plugin: JSON values in a file of its own, outside the document. */
	'plugins:storageGet': { payload: { pluginId: string; key: string }; result: unknown };
	'plugins:storageSet': {
		payload: { pluginId: string; key: string; value: unknown };
		result: void;
	};
	'plugins:storageDelete': { payload: { pluginId: string; key: string }; result: void };
	'plugins:storageKeys': { payload: { pluginId: string }; result: string[] };
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
	/** A known file was renamed, moved or trashed; open tabs and the home screen follow. */
	'files:moved': FileMovedMessage;
	/** A native menu item was clicked: run this command. */
	'menu:command': { command: string; args?: unknown };
	'ai:event': AiEventMessage;
	'ai:tool-call': AiToolCallMessage;
	/** A plugin root changed (added, removed, edited) or the window's project did. */
	'plugins:changed': PluginList;
	/** The files of one user or project plugin changed: reload it. */
	'plugins:reload': PluginReloadMessage;
}
export type IpcEventChannel = keyof IpcEvents;

// The whitelist of push channels the preload exposes. The check below makes a channel missing
// from it a compile error.
export const EVENT_CHANNELS = [
	'kernel:boot-report',
	'window:maximized',
	'files:flush-request',
	'files:open-request',
	'files:moved',
	'menu:command',
	'ai:event',
	'ai:tool-call',
	'plugins:changed',
	'plugins:reload'
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
	diagnostics: {
		read(): Promise<DiagnosticsReport>;
		restart(safeMode: boolean): Promise<void>;
	};
	dialogs: {
		openFile(options?: OpenFileOptions): Promise<string[] | null>;
		saveFile(options?: SaveFileOptions): Promise<string | null>;
		/** Pick image files (png, jpeg, webp, gif, svg); `null` when cancelled. */
		openImages(): Promise<PickedImage[] | null>;
	};
	exports: {
		write(files: ExportFileData[]): Promise<string[] | null>;
	};
	archive: {
		export(suggestedName: string, entries: ArchiveEntry[]): Promise<string | null>;
		read(): Promise<{ path: string; entries: ArchiveEntry[] } | null>;
		createFile(request: CreateFromArchiveRequest): Promise<string | null>;
	};
	clipboard: {
		read(): Promise<ClipboardContent>;
		write(content: ClipboardWrite): Promise<void>;
	};
	menu: {
		/** Mirror the menu bar to the native application menu. */
		set(items: NativeMenuItem[]): Promise<void>;
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
	versions: {
		list(): Promise<VersionHistoryData>;
		add(name: string): Promise<VersionMark>;
		remove(id: string): Promise<void>;
		restorePlan(seq: number): Promise<RestorePlan>;
	};
	settings: {
		load(): Promise<SettingsData>;
		save(data: SettingsData): Promise<void>;
	};
	assets: {
		put(request: AssetPutRequest): Promise<AssetPutResult>;
		get(hash: string): Promise<Uint8Array | null>;
		collect(): Promise<string[]>;
		embedFont(ref: FontRef, bytes: Uint8Array): Promise<void>;
		fontBytes(ref: FontRef): Promise<Uint8Array | null>;
		embeddedFonts(): Promise<FontRef[]>;
	};
	files: {
		new(directory?: string): Promise<LoadedDocument>;
		open(path: string): Promise<LoadedDocument>;
		openDialog(): Promise<string | null>;
		saveDialog(suggestedName: string): Promise<string | null>;
		saveAs(path: string): Promise<StoreInfo>;
		launchRequest(): Promise<string | null>;
		recent(): Promise<LibraryFile[]>;
		removeRecent(path: string): Promise<void>;
		reveal(path: string): Promise<void>;
		clearRecent(): Promise<void>;
		setThumbnail(thumbnail: Thumbnail): Promise<void>;
		flushed(requestId: string): Promise<void>;
		/** The path of a file dropped on the window (Electron no longer exposes `File.path`). */
		pathForFile(file: File): string;
	};
	library: {
		overview(): Promise<LibraryOverview>;
		list(directory: string): Promise<DirectoryListing>;
		search(query: string): Promise<LibraryFile[]>;
		createFolder(parent: string, name: string): Promise<LibraryFolder>;
		renameFolder(path: string, name: string): Promise<LibraryFolder>;
		trashFolder(path: string): Promise<void>;
		renameFile(path: string, name: string): Promise<LibraryFile>;
		moveFile(path: string, directory: string): Promise<LibraryFile>;
		duplicateFile(path: string): Promise<LibraryFile>;
		trashFile(path: string): Promise<void>;
		linkFolder(): Promise<LinkedFolder | null>;
		unlinkFolder(id: string): Promise<void>;
	};
	events: {
		/** Subscribe to a main-to-renderer push; the returned function unsubscribes. */
		on<Channel extends IpcEventChannel>(
			channel: Channel,
			listener: (payload: IpcEvents[Channel]) => void
		): () => void;
	};
	ai: {
		providers(): Promise<AiProviderInfo[]>;
		start(request: AiStartRequest): Promise<{ sessionId: string }>;
		send(request: AiSendRequest): Promise<void>;
		cancel(sessionId: string): Promise<void>;
		end(sessionId: string): Promise<void>;
		toolResult(result: AiToolResultMessage): Promise<void>;
	};
	plugins: {
		list(): Promise<PluginList>;
		setTrust(trusted: boolean): Promise<PluginList>;
		readFile(source: PluginSourceKind, directoryName: string, file: string): Promise<string>;
		install(path: string): Promise<PluginList>;
		create(id: string, name: string, template: 'blank' | 'panel' | 'figma'): Promise<PluginList>;
		installFromDialog(kind: 'folder' | 'zip'): Promise<PluginList | null>;
		remove(directoryName: string): Promise<PluginList>;
		reveal(source: PluginSourceKind, directoryName: string): Promise<void>;
		permissions(): Promise<PluginPermissionDecisions>;
		setPermission(
			pluginId: string,
			permission: string,
			granted: boolean | null
		): Promise<PluginPermissionDecisions>;
		fetch(request: PluginFetchRequest): Promise<PluginFetchResponse>;
		storageGet(pluginId: string, key: string): Promise<unknown>;
		storageSet(pluginId: string, key: string, value: unknown): Promise<void>;
		storageDelete(pluginId: string, key: string): Promise<void>;
		storageKeys(pluginId: string): Promise<string[]>;
	};
	system: {
		platform: NodeJS.Platform;
		arch: string;
	};
}
