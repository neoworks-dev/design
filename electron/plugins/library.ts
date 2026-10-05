// main-library: the `library` service and the read side of the `library:*` routes. The library is a
// directory Draftboard owns (`$XDG_DATA_HOME/draftboard` on Linux) whose `.ndesign` files are the
// drafts and whose direct subdirectories are folders (data-model.md section 7). The user can also
// link directories elsewhere on disk; their files are listed the same way.
//
// This service owns the path policy: every directory the routes accept is the library root, a
// library folder, a linked folder or a direct subdirectory of a linked folder, compared by real
// path so a symlink cannot lead out. It also owns the recent list. Operations that must follow an
// open document (rename, move, trash) live in `main-library-operations`.

import { lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import type {
	DirectoryListing,
	FileLocation,
	LibraryFile,
	LibraryFolder,
	LibraryOverview,
	LinkedFolder,
	Thumbnail
} from '../bridge';
import { route } from '../kernel/route';
import { FILE_EXTENSION } from '../store/constants';
import { DocumentFile, removeFileAndSidecars } from '../store/documentFile';
import { StoreError } from '../store/errors';
import {
	LibraryError,
	displayNameOf,
	isDesignFilePath,
	isDirectory,
	libraryRootFor,
	moveFileSync,
	readDirectory,
	realOrResolved,
	uniqueName,
	validateFileName,
	validateName
} from '../store/library';
import { RECENT_FILES_NAME, RecentFilesStore } from '../store/recentFiles';
import {
	LINKED_FOLDERS_NAME,
	LinkedFoldersStore,
	type LinkedFolderEntry
} from '../store/linkedFolders';

/** The `thumbnails` key of a document's own preview. */
export const FILE_THUMBNAIL_KEY = 'file';
export const LEGACY_UNTITLED_DIRECTORY = 'untitled';
const SEARCH_RESULT_LIMIT = 200;

export interface LibraryConfig {
	/** The library root; default: `DRAFTBOARD_LIBRARY_DIR` or the platform's data directory. */
	libraryDirectory?: string;
	/** Environment the root is read from; default `process.env`. */
	env?: NodeJS.ProcessEnv;
}

/** What a directory is to the library. */
export type DirectoryKind =
	| { kind: 'root' }
	| { kind: 'folder' }
	| { kind: 'linked'; entry: LinkedFolderEntry }
	| { kind: 'linkedChild'; entry: LinkedFolderEntry };

export interface ResolvedDirectory {
	/** Real path. */
	path: string;
	directory: DirectoryKind;
}

export class LibraryService extends Service {
	private readonly configuredRoot: string | null;
	private readonly env: NodeJS.ProcessEnv;
	private linkedStore: LinkedFoldersStore | null = null;
	private recentStore: RecentFilesStore | null = null;

	constructor(ctx: Context, config: LibraryConfig = {}) {
		super(ctx, 'library');
		this.configuredRoot = config.libraryDirectory === undefined ? null : config.libraryDirectory;
		this.env = config.env === undefined ? process.env : config.env;
	}

	// ---------- the root ----------

	/** The library root's real path when it exists; never creates it. */
	rootPath(): string {
		return realOrResolved(this.configuredRootPath());
	}

	/** Create the root on first use and return its real path. */
	ensureRoot(): string {
		mkdirSync(this.configuredRootPath(), { recursive: true });
		return this.rootPath();
	}

	private configuredRootPath(): string {
		if (this.configuredRoot !== null) return path.resolve(this.configuredRoot);
		const app = this.ctx.electron.app;
		return libraryRootFor({
			platform: app.platform,
			env: this.env,
			documentsPath: app.getPath('documents'),
			homePath: app.getPath('home')
		});
	}

	// ---------- path policy ----------

	/** Classify a real directory path; `null` when the library does not know it. */
	classifyDirectory(directory: string): DirectoryKind | null {
		const root = this.rootPath();
		if (directory === root) return { kind: 'root' };
		if (path.dirname(directory) === root) return { kind: 'folder' };
		for (const entry of this.linkedEntries()) {
			const linked = realOrResolved(entry.path);
			if (directory === linked) return { kind: 'linked', entry };
			if (path.dirname(directory) === linked) return { kind: 'linkedChild', entry };
		}
		return null;
	}

	/** A directory argument of a route: it must be one the library knows. */
	resolveDirectory(argument: string): ResolvedDirectory {
		this.ensureRoot();
		const resolved = path.resolve(argument);
		if (!isDirectory(resolved)) {
			throw new LibraryError('NOT_FOUND', `"${resolved}" is not an available directory.`);
		}
		const real = realpathSync(resolved);
		const directory = this.classifyDirectory(real);
		if (directory === null) {
			throw new LibraryError(
				'OUTSIDE_LIBRARY',
				`"${resolved}" is neither in the library nor in a linked folder.`
			);
		}
		return { path: real, directory };
	}

	/** A file in the library or a linked folder, as a route argument for changing operations. */
	managedFile(argument: string): string {
		const resolved = path.resolve(argument);
		if (!isDesignFilePath(resolved)) {
			throw new LibraryError('INVALID_NAME', `"${resolved}" is not a .${FILE_EXTENSION} file.`);
		}
		const directory = this.resolveDirectory(path.dirname(resolved));
		const file = path.join(directory.path, path.basename(resolved));
		let stats;
		try {
			stats = lstatSync(file);
		} catch {
			throw new LibraryError('NOT_FOUND', `"${file}" does not exist.`);
		}
		if (stats.isSymbolicLink() || !stats.isFile()) {
			throw new LibraryError('OUTSIDE_LIBRARY', `"${file}" is not a regular design file.`);
		}
		return file;
	}

	/** Like `managedFile`, and also any file on the recent list (reveal, forget). */
	knownFile(argument: string): string {
		try {
			return this.managedFile(argument);
		} catch (error) {
			if (!(error instanceof LibraryError)) throw error;
			const resolved = realOrResolved(argument);
			if (isDesignFilePath(resolved) && this.isRecent(resolved)) return resolved;
			throw error;
		}
	}

	/** A file `files:open` may open: a design file anywhere (dialog, drop, OS), checked on open. */
	openableFile(argument: string): string {
		const resolved = path.resolve(argument);
		if (!isDesignFilePath(resolved)) {
			throw new LibraryError('INVALID_NAME', `"${resolved}" is not a .${FILE_EXTENSION} file.`);
		}
		return resolved;
	}

	/** A folder `rename` and `trash` may change: a library folder or a subdirectory of a linked one. */
	managedFolder(argument: string): string {
		const resolved = this.resolveDirectory(argument);
		if (resolved.directory.kind === 'folder' || resolved.directory.kind === 'linkedChild') {
			return resolved.path;
		}
		throw new LibraryError('OUTSIDE_LIBRARY', 'Only folders can be renamed or deleted.');
	}

	private isRecent(file: string): boolean {
		return this.recents()
			.entries()
			.some((entry) => realOrResolved(entry.path) === file);
	}

	// ---------- locations and descriptions ----------

	locate(file: string): FileLocation {
		const directory = realOrResolved(path.dirname(path.resolve(file)));
		const kind = this.classifyDirectory(directory);
		if (kind === null) return { kind: 'external' };
		if (kind.kind === 'root') return { kind: 'library', folder: '' };
		if (kind.kind === 'folder') return { kind: 'library', folder: path.basename(directory) };
		if (kind.kind === 'linked') return { kind: 'linked', linkedId: kind.entry.id, folder: '' };
		return { kind: 'linked', linkedId: kind.entry.id, folder: path.basename(directory) };
	}

	isInLibrary(file: string): boolean {
		return this.locate(file).kind === 'library';
	}

	private describeFile(file: string, openedAt: number | null): LibraryFile {
		return {
			path: file,
			name: displayNameOf(file),
			modifiedAt: statSync(file).mtimeMs,
			openedAt,
			location: this.locate(file),
			thumbnail: this.readThumbnailFromDisk(file)
		};
	}

	/** One file as the home screen lists it; `openedAt` comes from the recent list. */
	describe(file: string): LibraryFile {
		return this.describeFile(file, this.openedAtOf(file));
	}

	private openedAtOf(file: string): number | null {
		const real = realOrResolved(file);
		const entry = this.recents()
			.entries()
			.find((candidate) => realOrResolved(candidate.path) === real);
		if (entry === undefined) return null;
		return entry.openedAt;
	}

	private readThumbnailFromDisk(file: string): Thumbnail | null {
		let peeked: DocumentFile | null = null;
		try {
			peeked = DocumentFile.open(file, { session: false });
			return peeked.readThumbnail(FILE_THUMBNAIL_KEY);
		} catch (error) {
			if (!(error instanceof StoreError)) throw error;
			return null;
		} finally {
			peeked?.close();
		}
	}

	/** One folder as the sidebar lists it. */
	describeFolder(directory: string): LibraryFolder {
		return {
			path: directory,
			name: path.basename(directory),
			fileCount: readDirectory(directory).files.length,
			modifiedAt: statSync(directory).mtimeMs
		};
	}

	// ---------- reading ----------

	overview(): LibraryOverview {
		const root = this.ensureRoot();
		return {
			root,
			folders: readDirectory(root).folders.map((name) =>
				this.describeFolder(path.join(root, name))
			),
			linked: this.linkedFolders()
		};
	}

	list(directory: string): DirectoryListing {
		const resolved = this.resolveDirectory(directory);
		const contents = readDirectory(resolved.path);
		const kind = resolved.directory.kind;
		const folders: string[] = [];
		if (kind === 'root' || kind === 'linked') folders.push(...contents.folders);
		const opened = this.openedAtByPath();
		return {
			directory: resolved.path,
			folders: folders.map((name) => this.describeFolder(path.join(resolved.path, name))),
			files: contents.files.map((name) => {
				const file = path.join(resolved.path, name);
				return this.describeFile(file, opened.get(file) ?? null);
			})
		};
	}

	/** Design files whose name contains `query` in the library and the linked folders. */
	search(query: string): LibraryFile[] {
		const needle = query.trim().toLowerCase();
		if (needle === '') return [];
		const opened = this.openedAtByPath();
		const matches: LibraryFile[] = [];
		for (const directory of this.searchableDirectories()) {
			for (const name of readDirectory(directory).files) {
				if (!displayNameOf(name).toLowerCase().includes(needle)) continue;
				const file = path.join(directory, name);
				matches.push(this.describeFile(file, opened.get(file) ?? null));
			}
		}
		matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
		return matches.slice(0, SEARCH_RESULT_LIMIT);
	}

	private searchableDirectories(): string[] {
		const roots = [this.ensureRoot()];
		for (const entry of this.linkedEntries()) {
			if (isDirectory(entry.path)) roots.push(realOrResolved(entry.path));
		}
		const directories = [...roots];
		for (const root of roots) {
			for (const name of readDirectory(root).folders) directories.push(path.join(root, name));
		}
		return directories;
	}

	private openedAtByPath(): Map<string, number> {
		const opened = new Map<string, number>();
		for (const entry of this.recents().entries()) {
			opened.set(realOrResolved(entry.path), entry.openedAt);
		}
		return opened;
	}

	// ---------- folders ----------

	/** Make a folder in the library root or the top of a linked folder; a taken name gets ` 2`. */
	createFolder(parent: string, name: string): LibraryFolder {
		const validated = validateName(name);
		const resolved = this.resolveDirectory(parent);
		if (resolved.directory.kind !== 'root' && resolved.directory.kind !== 'linked') {
			throw new LibraryError('OUTSIDE_LIBRARY', 'Folders can only be made one level deep.');
		}
		const unique = uniqueName(resolved.path, validated, '');
		const created = path.join(resolved.path, unique);
		mkdirSync(created);
		return this.describeFolder(created);
	}

	/** The path `folder` gets when renamed to `name`; throws when the name is taken. */
	renamedFolderPath(folder: string, name: string): string {
		const target = path.join(path.dirname(folder), validateName(name));
		if (target !== folder && isTaken(target)) {
			throw new LibraryError('ALREADY_EXISTS', `"${path.basename(target)}" already exists.`);
		}
		return target;
	}

	/** The path `file` gets when renamed to `name`; throws when the name is taken. */
	renamedFilePath(file: string, name: string): string {
		const fileName = `${validateFileName(name)}.${FILE_EXTENSION}`;
		const target = path.join(path.dirname(file), fileName);
		if (target !== file && isTaken(target)) {
			throw new LibraryError('ALREADY_EXISTS', `"${fileName}" already exists.`);
		}
		return target;
	}

	// ---------- linked folders ----------

	linkedFolders(): LinkedFolder[] {
		return this.linkedEntries().map((entry) => ({
			id: entry.id,
			name: entry.name,
			path: entry.path,
			available: isDirectory(entry.path)
		}));
	}

	/** Ask for a directory and add it to the sidebar; `null` when the user cancelled. */
	async linkFolder(): Promise<LinkedFolder | null> {
		const chosen = await this.ctx.electron.dialog.showOpenDialog({
			title: 'Add folder',
			defaultPath: this.ensureRoot(),
			multiple: false,
			directory: true
		});
		if (chosen === null || chosen.length === 0) return null;
		const directory = realOrResolved(chosen[0]);
		if (!isDirectory(directory)) {
			throw new LibraryError('NOT_FOUND', `"${directory}" is not a directory.`);
		}
		const root = this.rootPath();
		if (directory === root || directory.startsWith(`${root}${path.sep}`)) {
			throw new LibraryError('ALREADY_EXISTS', 'The library is already part of Draftboard.');
		}
		const entry = this.linkedStoreFile().add(directory);
		return { id: entry.id, name: entry.name, path: entry.path, available: true };
	}

	unlinkFolder(id: string): void {
		this.linkedStoreFile().remove(id);
	}

	private linkedEntries(): LinkedFolderEntry[] {
		return this.linkedStoreFile().list();
	}

	private linkedStoreFile(): LinkedFoldersStore {
		if (this.linkedStore === null) {
			const userData = this.ctx.electron.app.getPath('userData');
			this.linkedStore = new LinkedFoldersStore(path.join(userData, LINKED_FOLDERS_NAME));
		}
		return this.linkedStore;
	}

	// ---------- recent files ----------

	recents(): RecentFilesStore {
		if (this.recentStore === null) {
			const userData = this.ctx.electron.app.getPath('userData');
			this.recentStore = new RecentFilesStore(path.join(userData, RECENT_FILES_NAME));
		}
		return this.recentStore;
	}

	/** Remember `file` as the newest recent file; the OS list follows ours. */
	recordRecent(file: string, name: string): void {
		const real = realOrResolved(file);
		this.recents().record(real, name);
		this.ctx.electron.app.addRecentDocument(real);
	}

	/** Recent documents, newest first; vanished files are pruned, thumbnails read from each file. */
	recentFiles(): LibraryFile[] {
		return this.recents()
			.list()
			.map((entry) => this.describeFile(entry.path, entry.openedAt));
	}

	/** Dialog defaults: the library root, created on first use. */
	dialogDirectory(): string {
		return this.ensureRoot();
	}

	// ---------- migration ----------

	/**
	 * Earlier versions kept untitled documents in `<userData>/untitled/`. The ones with edits move
	 * into the library root under a unique name, empty ones are deleted, and the directory goes
	 * once it is empty.
	 */
	migrateUntitled(): void {
		const userData = this.ctx.electron.app.getPath('userData');
		const legacy = path.join(userData, LEGACY_UNTITLED_DIRECTORY);
		if (!isDirectory(legacy)) return;
		for (const name of readdirSync(legacy)) {
			if (!isDesignFilePath(name)) continue;
			this.migrateUntitledFile(path.join(legacy, name));
		}
		try {
			rmdirSync(legacy);
		} catch {
			// something unreadable is still in there; leave it for the user
		}
	}

	private migrateUntitledFile(file: string): void {
		let name: string;
		let hasEdits: boolean;
		let peeked: DocumentFile | null = null;
		try {
			peeked = DocumentFile.open(file, { session: false });
			const info = peeked.info();
			name = info.name;
			hasEdits = info.unsaved;
		} catch (error) {
			if (!(error instanceof StoreError)) throw error;
			this.ctx.logger.warn(`untitled file ${file} cannot be read and is left alone`);
			return;
		} finally {
			peeked?.close();
		}
		if (!hasEdits) {
			removeFileAndSidecars(file);
			return;
		}
		const root = this.ensureRoot();
		const unique = uniqueName(root, fileNameFor(name), `.${FILE_EXTENSION}`);
		const target = path.join(root, `${unique}.${FILE_EXTENSION}`);
		moveFileSync(file, target);
		removeFileAndSidecars(file);
		this.renameDocument(target, unique);
	}

	private renameDocument(file: string, name: string): void {
		const document = DocumentFile.open(file, { session: false });
		try {
			if (document.info().name !== name) document.setName(name);
		} finally {
			document.close();
		}
	}

	snapshotState(): Record<string, unknown> {
		return { root: this.rootPath(), linked: this.linkedEntries().map((entry) => entry.path) };
	}
}

function fileNameFor(documentName: string): string {
	try {
		return validateFileName(documentName);
	} catch {
		return 'Untitled';
	}
}

function isTaken(target: string): boolean {
	try {
		lstatSync(target);
		return true;
	} catch {
		return false;
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		library: LibraryService;
	}
}

export const mainLibraryPlugin: Plugin.Object<LibraryConfig> = {
	name: 'main-library',
	inject: ['electron', 'ipc'],
	apply(ctx, config) {
		const library = new LibraryService(ctx, config);

		route(ctx, 'library:overview', () => library.overview());
		route(ctx, 'library:list', (request) => library.list(request.directory));
		route(ctx, 'library:search', (request) => library.search(request.query));
		route(ctx, 'library:createFolder', (request) =>
			library.createFolder(request.parent, request.name)
		);
		route(ctx, 'library:linkFolder', () => library.linkFolder());
		route(ctx, 'library:unlinkFolder', (request) => library.unlinkFolder(request.id));

		// A one-off data migration: nothing to undo, so the inverse is empty.
		ctx.effect(() => {
			library.migrateUntitled();
			return () => {};
		}, 'main-library:migrate-untitled');
	}
};
