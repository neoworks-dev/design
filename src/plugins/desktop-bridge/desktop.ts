// The renderer's `desktop` service: `window.desktop` (the preload bridge) behind a service, so
// plugins `inject: ['desktop']` instead of touching the global and tests can provide a fake.
//
// Errors cross Electron's context bridge as plain `Error`s whose `name` and extra properties are
// dropped; only the message survives, as `CODE: text`. The service turns that back into a typed
// `DesktopError`.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	AiProviderInfo,
	AiSendRequest,
	AiStartRequest,
	AiToolResultMessage,
	AppPathName,
	AssetPutRequest,
	AssetPutResult,
	BootReport,
	ClipboardContent,
	ClipboardWrite,
	CommitResult,
	CreateStoreRequest,
	DraftFile,
	ExportFileData,
	DesktopBridge,
	FontRef,
	IpcErrorCode,
	IpcEventChannel,
	IpcEvents,
	LoadedDocument,
	NativeMenuItem,
	PluginFetchRequest,
	PluginFetchResponse,
	PluginList,
	PluginPermissionDecisions,
	PluginSourceKind,
	OpenFileOptions,
	PickedImage,
	RecentFile,
	SaveFileOptions,
	SettingsData,
	StoreInfo,
	Thumbnail
} from '../../../electron/bridge';
import type { Transaction } from '../../lib/document';

const ERROR_CODES: readonly IpcErrorCode[] = [
	'INVALID_PAYLOAD',
	'FORBIDDEN_SENDER',
	'HANDLER_FAILED',
	'UNKNOWN_CHANNEL'
];

export class DesktopError extends Error {
	constructor(
		readonly code: IpcErrorCode,
		message: string
	) {
		super(message);
		this.name = 'DesktopError';
	}
}

/** The typed error for a message of the form `CODE: text`, or `null` for any other error. */
export function parseBridgeError(error: unknown): DesktopError | null {
	if (!(error instanceof Error)) return null;
	const separator = error.message.indexOf(': ');
	if (separator < 0) return null;
	const code = ERROR_CODES.find((candidate) => candidate === error.message.slice(0, separator));
	if (!code) return null;
	return new DesktopError(code, error.message.slice(separator + 2));
}

async function typed<Value>(call: () => Promise<Value>): Promise<Value> {
	try {
		return await call();
	} catch (error) {
		const parsed = parseBridgeError(error);
		if (parsed) throw parsed;
		throw error;
	}
}

export class DesktopService extends Service {
	constructor(
		ctx: Context,
		private readonly bridge: DesktopBridge,
		private readonly native: boolean = true
	) {
		super(ctx, 'desktop');
	}

	/** False when the app runs in a plain browser on the in-memory fallback bridge. */
	get isNative(): boolean {
		return this.native;
	}

	get platform(): NodeJS.Platform {
		return this.bridge.system.platform;
	}

	get arch(): string {
		return this.bridge.system.arch;
	}

	minimizeWindow(): Promise<void> {
		return typed(() => this.bridge.window.minimize());
	}

	/** Resolves with whether the window is maximized afterwards. */
	toggleMaximizeWindow(): Promise<boolean> {
		return typed(() => this.bridge.window.toggleMaximize());
	}

	/** Whether the window is maximized now; `window:maximized` pushes the changes after that. */
	isWindowMaximized(): Promise<boolean> {
		return typed(() => this.bridge.window.isMaximized());
	}

	closeWindow(): Promise<void> {
		return typed(() => this.bridge.window.close());
	}

	version(): Promise<string> {
		return typed(() => this.bridge.app.version());
	}

	path(name: AppPathName): Promise<string> {
		return typed(() => this.bridge.app.path(name));
	}

	quit(): Promise<void> {
		return typed(() => this.bridge.app.quit());
	}

	/** What the main kernel booted; `null` until main finished booting. */
	mainBootReport(): Promise<BootReport | null> {
		return typed(() => this.bridge.app.bootReport());
	}

	openFileDialog(options?: OpenFileOptions): Promise<string[] | null> {
		return typed(() => this.bridge.dialogs.openFile(options));
	}

	/** Pick image files in the native dialog; main reads them. `null` when cancelled. */
	openImagesDialog(): Promise<PickedImage[] | null> {
		return typed(() => this.bridge.dialogs.openImages());
	}

	saveFileDialog(options?: SaveFileOptions): Promise<string | null> {
		return typed(() => this.bridge.dialogs.saveFile(options));
	}

	/**
	 * Write exported files in main: a save dialog for one, a folder dialog for several. The
	 * written paths, or `null` when the user cancelled.
	 */
	writeExports(files: ExportFileData[]): Promise<string[] | null> {
		return typed(() => this.bridge.exports.write(files));
	}

	/** What the OS clipboard holds (text, html and a PNG image, each `null` when absent). */
	clipboardRead(): Promise<ClipboardContent> {
		return typed(() => this.bridge.clipboard.read());
	}

	/** Replace the OS clipboard with the given kinds, written together. */
	clipboardWrite(content: ClipboardWrite): Promise<void> {
		return typed(() => this.bridge.clipboard.write(content));
	}

	/** Replace the native application menu (main builds it; clicks come back as `menu:command`). */
	setNativeMenu(items: NativeMenuItem[]): Promise<void> {
		return typed(() => this.bridge.menu.set(items));
	}

	/** Installed system font faces, sorted by family then style. */
	listSystemFonts(): Promise<FontRef[]> {
		return typed(() => this.bridge.fonts.list());
	}

	/** Bytes of an installed font file; `null` when no installed face matches. */
	loadSystemFont(ref: FontRef): Promise<Uint8Array | null> {
		return typed(() => this.bridge.fonts.load(ref));
	}

	/** Open an existing design file as this window's document. */
	storeOpen(path: string): Promise<StoreInfo> {
		return typed(() => this.bridge.store.open(path));
	}

	/** Create a design file (blank unless a document is given) and make it this window's. */
	storeCreate(request: CreateStoreRequest): Promise<StoreInfo> {
		return typed(() => this.bridge.store.create(request));
	}

	/** The whole document of the file this window has open. */
	storeLoad(): Promise<LoadedDocument> {
		return typed(() => this.bridge.store.load());
	}

	storeClose(): Promise<void> {
		return typed(() => this.bridge.store.close());
	}

	/** Persist committed document transactions, oldest first (autosave). */
	storeCommit(transactions: Transaction[]): Promise<CommitResult> {
		return typed(() => this.bridge.store.commit(transactions));
	}

	/** Save: checkpoint the open file and clear its unsaved marker. */
	storeCheckpoint(): Promise<StoreInfo> {
		return typed(() => this.bridge.store.checkpoint());
	}

	// ---------- settings ----------

	/** The stored preferences (empty when none were saved). */
	settingsLoad(): Promise<SettingsData> {
		return typed(() => this.bridge.settings.load());
	}

	/** Replace the stored preferences; main writes the file atomically. */
	settingsSave(data: SettingsData): Promise<void> {
		return typed(() => this.bridge.settings.save(data));
	}

	// ---------- AI agent (main-ai) ----------

	aiProviders(): Promise<AiProviderInfo[]> {
		return typed(() => this.bridge.ai.providers());
	}

	aiStart(request: AiStartRequest): Promise<{ sessionId: string }> {
		return typed(() => this.bridge.ai.start(request));
	}

	aiSend(request: AiSendRequest): Promise<void> {
		return typed(() => this.bridge.ai.send(request));
	}

	aiCancel(sessionId: string): Promise<void> {
		return typed(() => this.bridge.ai.cancel(sessionId));
	}

	aiEnd(sessionId: string): Promise<void> {
		return typed(() => this.bridge.ai.end(sessionId));
	}

	aiToolResult(result: AiToolResultMessage): Promise<void> {
		return typed(() => this.bridge.ai.toolResult(result));
	}

	// ---------- third-party plugins (main-plugins) ----------

	/** The plugins found in the bundled, user and project roots for this window. */
	pluginsList(): Promise<PluginList> {
		return typed(() => this.bridge.plugins.list());
	}

	/** Trust or distrust this window's project; answers the new list. */
	pluginsSetTrust(trusted: boolean): Promise<PluginList> {
		return typed(() => this.bridge.plugins.setTrust(trusted));
	}

	/** A file of a plugin (its main module) as text. */
	pluginsReadFile(source: PluginSourceKind, directoryName: string, file: string): Promise<string> {
		return typed(() => this.bridge.plugins.readFile(source, directoryName, file));
	}

	pluginsInstall(path: string): Promise<PluginList> {
		return typed(() => this.bridge.plugins.install(path));
	}

	pluginsCreate(
		id: string,
		name: string,
		template: 'blank' | 'panel' | 'figma'
	): Promise<PluginList> {
		return typed(() => this.bridge.plugins.create(id, name, template));
	}

	/** A native dialog for a plugin folder or `.zip`, then install; `null` when cancelled. */
	pluginsInstallFromDialog(kind: 'folder' | 'zip'): Promise<PluginList | null> {
		return typed(() => this.bridge.plugins.installFromDialog(kind));
	}

	pluginsRemove(directoryName: string): Promise<PluginList> {
		return typed(() => this.bridge.plugins.remove(directoryName));
	}

	pluginsReveal(source: PluginSourceKind, directoryName: string): Promise<void> {
		return typed(() => this.bridge.plugins.reveal(source, directoryName));
	}

	/** What the user allowed or denied each plugin. */
	pluginsPermissions(): Promise<PluginPermissionDecisions> {
		return typed(() => this.bridge.plugins.permissions());
	}

	pluginsSetPermission(
		pluginId: string,
		permission: string,
		granted: boolean | null
	): Promise<PluginPermissionDecisions> {
		return typed(() => this.bridge.plugins.setPermission(pluginId, permission, granted));
	}

	/** An HTTP request for a plugin; main checks its `network` permission and allowlist. */
	pluginsFetch(request: PluginFetchRequest): Promise<PluginFetchResponse> {
		return typed(() => this.bridge.plugins.fetch(request));
	}

	pluginsStorageGet(pluginId: string, key: string): Promise<unknown> {
		return typed(() => this.bridge.plugins.storageGet(pluginId, key));
	}

	pluginsStorageSet(pluginId: string, key: string, value: unknown): Promise<void> {
		return typed(() => this.bridge.plugins.storageSet(pluginId, key, value));
	}

	pluginsStorageDelete(pluginId: string, key: string): Promise<void> {
		return typed(() => this.bridge.plugins.storageDelete(pluginId, key));
	}

	pluginsStorageKeys(pluginId: string): Promise<string[]> {
		return typed(() => this.bridge.plugins.storageKeys(pluginId));
	}

	// ---------- assets and embedded fonts ----------

	/** Store image bytes in the open file under their sha-256. */
	assetsPut(request: AssetPutRequest): Promise<AssetPutResult> {
		return typed(() => this.bridge.assets.put(request));
	}

	/** Stored image bytes by hash; `null` when the file has none. */
	assetsGet(hash: string): Promise<Uint8Array | null> {
		return typed(() => this.bridge.assets.get(hash));
	}

	/** Delete stored images nothing references; the removed hashes. */
	assetsCollect(): Promise<string[]> {
		return typed(() => this.bridge.assets.collect());
	}

	assetsEmbedFont(ref: FontRef, bytes: Uint8Array): Promise<void> {
		return typed(() => this.bridge.assets.embedFont(ref, bytes));
	}

	assetsFontBytes(ref: FontRef): Promise<Uint8Array | null> {
		return typed(() => this.bridge.assets.fontBytes(ref));
	}

	assetsEmbeddedFonts(): Promise<FontRef[]> {
		return typed(() => this.bridge.assets.embeddedFonts());
	}

	// ---------- files ----------

	/** Tabs: open `path` as the window's document, keeping the previous one as a tab. */
	filesOpenInTab(path: string): Promise<LoadedDocument> {
		return typed(() => this.bridge.files.openInTab(path));
	}

	/** Tabs: a new untitled document, keeping the previous one as a tab. */
	filesNewInTab(): Promise<LoadedDocument> {
		return typed(() => this.bridge.files.newInTab());
	}

	/** Tabs: may the current document be closed? Asks about untitled edits; false when cancelled. */
	filesConfirmClose(): Promise<boolean> {
		return typed(() => this.bridge.files.confirmClose());
	}

	/** Tabs: delete a closed untitled document's temporary file. */
	filesDiscard(path: string): Promise<void> {
		return typed(() => this.bridge.files.discard(path));
	}

	/** A new empty document in a temporary file; becomes this window's document. */
	filesNewUntitled(): Promise<LoadedDocument | null> {
		return typed(() => this.bridge.files.newUntitled());
	}

	/** Open a design file as this window's document and load it. */
	filesOpen(path: string): Promise<LoadedDocument | null> {
		return typed(() => this.bridge.files.open(path));
	}

	/** The native open dialog for design files; `null` when cancelled. */
	filesOpenDialog(): Promise<string | null> {
		return typed(() => this.bridge.files.openDialog());
	}

	/** The native save dialog for design files; `null` when cancelled. */
	filesSaveDialog(suggestedName: string): Promise<string | null> {
		return typed(() => this.bridge.files.saveDialog(suggestedName));
	}

	/** Copy the open file to `path` and continue editing the copy. */
	filesSaveAs(path: string): Promise<StoreInfo> {
		return typed(() => this.bridge.files.saveAs(path));
	}

	/** Offer to restore an untitled document a crash left behind. */
	filesOfferRecovery(): Promise<LoadedDocument | null> {
		return typed(() => this.bridge.files.offerRecovery());
	}

	/** The file this launch was asked to open, once. */
	filesLaunchRequest(): Promise<string | null> {
		return typed(() => this.bridge.files.launchRequest());
	}

	/** Recently opened or saved documents, newest first. */
	filesRecent(): Promise<RecentFile[]> {
		return typed(() => this.bridge.files.recent());
	}

	/** Untitled documents with edits (including open ones), newest first. */
	filesDrafts(): Promise<DraftFile[]> {
		return typed(() => this.bridge.files.drafts());
	}

	/** Drop one file from the recent list (the file stays on disk). */
	filesRemoveRecent(path: string): Promise<void> {
		return typed(() => this.bridge.files.removeRecent(path));
	}

	/** Show a file in the OS file manager. */
	filesReveal(path: string): Promise<void> {
		return typed(() => this.bridge.files.reveal(path));
	}

	filesClearRecent(): Promise<void> {
		return typed(() => this.bridge.files.clearRecent());
	}

	/** Store the preview of the open document for the recent list (the renderer draws it). */
	filesSetThumbnail(thumbnail: Thumbnail): Promise<void> {
		return typed(() => this.bridge.files.setThumbnail(thumbnail));
	}

	/** Tell main the queued transactions are persisted (answer to `files:flush-request`). */
	filesFlushed(requestId: string): Promise<void> {
		return typed(() => this.bridge.files.flushed(requestId));
	}

	/** The path of a dropped file; empty when the platform does not know it. */
	pathForFile(file: File): string {
		return this.bridge.files.pathForFile(file);
	}

	/**
	 * Subscribe to a main-to-renderer push for the lifetime of the calling plugin: the
	 * subscription is a `ctx.effect` on the caller's context, so unmounting the caller
	 * unsubscribes. The returned function unsubscribes earlier.
	 */
	on<Channel extends IpcEventChannel>(
		channel: Channel,
		listener: (payload: IpcEvents[Channel]) => void
	): () => Promise<void> {
		return this.ctx.effect(() => this.bridge.events.on(channel, listener), `desktop:on:${channel}`);
	}
}
