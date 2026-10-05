// The renderer's `desktop` service: `window.desktop` (the preload bridge) behind a service, so
// plugins `inject: ['desktop']` instead of touching the global and tests can provide a fake.
//
// Errors cross Electron's context bridge as plain `Error`s whose `name` and extra properties are
// dropped; only the message survives, as `CODE: text`. The service turns that back into a typed
// `DesktopError`.

import { Service, type Context } from '@neoworks/extension-system';
import type {
	AppPathName,
	AssetPutRequest,
	AssetPutResult,
	BootReport,
	ClipboardContent,
	ClipboardWrite,
	CommitResult,
	CreateStoreRequest,
	DesktopBridge,
	FontRef,
	IpcErrorCode,
	IpcEventChannel,
	IpcEvents,
	LoadedDocument,
	OpenFileOptions,
	PickedImage,
	RecentFile,
	SaveFileOptions,
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

	/** What the OS clipboard holds (text, html and a PNG image, each `null` when absent). */
	clipboardRead(): Promise<ClipboardContent> {
		return typed(() => this.bridge.clipboard.read());
	}

	/** Replace the OS clipboard with the given kinds, written together. */
	clipboardWrite(content: ClipboardWrite): Promise<void> {
		return typed(() => this.bridge.clipboard.write(content));
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
