// main-library-operations: renaming, moving, duplicating and trashing files and folders of the
// library. Unlike the listing in `main-library` these must follow documents that are open: a
// window's renderer persists its queue, main closes the store, changes the file system, reopens
// the file at its new path for the same window and pushes `files:moved` to every window.

import { renameSync } from 'node:fs';
import path from 'node:path';
import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import type { LibraryFile, LibraryFolder } from '../bridge';
import type { SenderHandle } from '../kernel/host';
import { emitTo, route } from '../kernel/route';
import { FILE_EXTENSION } from '../store/constants';
import { DocumentFile } from '../store/documentFile';
import { displayNameOf, moveFileSync, realOrResolved, uniqueName } from '../store/library';

/** A file that is open in a window or on the recent list, with the path it is known by. */
interface KnownFile {
	path: string;
	holders: SenderHandle[];
}

function isInside(directory: string, file: string): boolean {
	return file.startsWith(`${directory}${path.sep}`);
}

export class LibraryOperations extends Service {
	constructor(ctx: Context) {
		super(ctx, 'libraryOperations');
	}

	// ---------- files ----------

	async renameFile(file: string, name: string): Promise<LibraryFile> {
		const source = this.ctx.library.managedFile(file);
		const target = this.ctx.library.renamedFilePath(source, name);
		if (target !== source) await this.relocateFile(source, target);
		return this.ctx.library.describe(target);
	}

	async moveFile(file: string, directory: string): Promise<LibraryFile> {
		const library = this.ctx.library;
		const source = library.managedFile(file);
		const destination = library.resolveDirectory(directory);
		if (destination.path === path.dirname(source)) return library.describe(source);
		const base = displayNameOf(source);
		const unique = uniqueName(destination.path, base, `.${FILE_EXTENSION}`);
		const target = path.join(destination.path, `${unique}.${FILE_EXTENSION}`);
		await this.relocateFile(source, target);
		return library.describe(target);
	}

	async duplicateFile(file: string): Promise<LibraryFile> {
		const library = this.ctx.library;
		const source = library.managedFile(file);
		const directory = path.dirname(source);
		const copyName = uniqueName(directory, `${displayNameOf(source)} copy`, `.${FILE_EXTENSION}`);
		const target = path.join(directory, `${copyName}.${FILE_EXTENSION}`);
		await this.copyFile(source, target, copyName);
		return library.describe(target);
	}

	async trashFile(file: string): Promise<void> {
		const source = this.ctx.library.managedFile(file);
		await this.trashPaths(source, [{ path: source, holders: this.holdersOf(source) }]);
	}

	// ---------- folders ----------

	async renameFolder(folder: string, name: string): Promise<LibraryFolder> {
		const library = this.ctx.library;
		const source = library.managedFolder(folder);
		const target = library.renamedFolderPath(source, name);
		if (target === source) return library.describeFolder(source);
		const affected = this.knownFilesInside(source);
		await this.closeAll(affected);
		try {
			renameSync(source, target);
		} catch (error) {
			await this.reopenAll(affected, (original) => original);
			throw error;
		}
		const mapped = (original: string): string => path.join(target, path.relative(source, original));
		await this.reopenAll(affected, mapped);
		for (const known of affected) {
			const moved = mapped(known.path);
			library.recents().replace(known.path, moved, displayNameOf(moved));
			this.pushMoved(known.path, moved);
		}
		return library.describeFolder(target);
	}

	async trashFolder(folder: string): Promise<void> {
		const source = this.ctx.library.managedFolder(folder);
		await this.trashPaths(source, this.knownFilesInside(source));
	}

	// ---------- internals ----------

	/** Move one file; a window that has it open keeps editing it at the new path. */
	private async relocateFile(source: string, target: string): Promise<void> {
		const library = this.ctx.library;
		const holders = this.holdersOf(source);
		await this.closeAll([{ path: source, holders }]);
		try {
			moveFileSync(source, target);
			this.renameDocument(target);
		} catch (error) {
			await this.reopenAll([{ path: source, holders }], (original) => original);
			throw error;
		}
		await this.reopenAll([{ path: source, holders }], () => target);
		library.recents().replace(source, target, displayNameOf(target));
		this.pushMoved(source, target);
	}

	/** The document's own name follows the file name. */
	private renameDocument(file: string): void {
		const name = displayNameOf(file);
		const document = DocumentFile.open(file, { session: false });
		try {
			if (document.info().name !== name) document.setName(name);
		} finally {
			document.close();
		}
	}

	/** Copy through SQLite (a copy of the raw file would miss what is still in the WAL). */
	private async copyFile(source: string, target: string, name: string): Promise<void> {
		const [holder] = this.holdersOf(source);
		if (holder !== undefined) {
			await this.ctx.files.flushSender(holder);
			this.ctx.store.current(holder).saveCopyTo(target, name);
			return;
		}
		const document = DocumentFile.open(source, { session: false });
		try {
			document.saveCopyTo(target, name);
		} finally {
			document.close();
		}
	}

	/** Trash `item` (a file or a folder) after closing what is open in it. */
	private async trashPaths(item: string, affected: KnownFile[]): Promise<void> {
		const library = this.ctx.library;
		await this.closeAll(affected);
		try {
			await this.ctx.electron.shell.trashItem(item);
		} catch (error) {
			await this.reopenAll(affected, (original) => original);
			throw error;
		}
		for (const known of affected) {
			library.recents().remove(known.path);
			this.pushMoved(known.path, null);
		}
	}

	private holdersOf(file: string): SenderHandle[] {
		const real = realOrResolved(file);
		return this.ctx.store
			.openFiles()
			.filter((open) => realOrResolved(open.path) === real)
			.map((open) => open.sender);
	}

	/** Open or recent files below `directory`, each listed once. */
	private knownFilesInside(directory: string): KnownFile[] {
		const known = new Map<string, KnownFile>();
		for (const entry of this.ctx.library.recents().entries()) {
			const real = realOrResolved(entry.path);
			if (isInside(directory, real)) known.set(real, { path: real, holders: [] });
		}
		for (const open of this.ctx.store.openFiles()) {
			const real = realOrResolved(open.path);
			if (!isInside(directory, real)) continue;
			const entry = known.get(real);
			if (entry === undefined) known.set(real, { path: real, holders: [open.sender] });
			else entry.holders.push(open.sender);
		}
		return [...known.values()];
	}

	private async closeAll(files: KnownFile[]): Promise<void> {
		for (const file of files) {
			for (const holder of file.holders) {
				await this.ctx.files.flushSender(holder);
				await this.ctx.store.close(holder);
			}
		}
	}

	/** Give every window that had a file open its document back, at `locate(original)`. */
	private async reopenAll(files: KnownFile[], locate: (original: string) => string): Promise<void> {
		for (const file of files) {
			const target = locate(file.path);
			for (const holder of file.holders) {
				await this.ctx.store.adopt(holder, () => DocumentFile.open(target));
			}
		}
	}

	private pushMoved(from: string, to: string | null): void {
		for (const window of this.ctx.electron.windows()) emitTo(window, 'files:moved', { from, to });
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		libraryOperations: LibraryOperations;
	}
}

export const mainLibraryOperationsPlugin: Plugin.Object = {
	name: 'main-library-operations',
	inject: ['electron', 'ipc', 'store', 'library', 'files'],
	apply(ctx) {
		const operations = new LibraryOperations(ctx);

		route(ctx, 'library:renameFolder', (request) =>
			operations.renameFolder(request.path, request.name)
		);
		route(ctx, 'library:trashFolder', (request) => operations.trashFolder(request.path));
		route(ctx, 'library:renameFile', (request) =>
			operations.renameFile(request.path, request.name)
		);
		route(ctx, 'library:moveFile', (request) =>
			operations.moveFile(request.path, request.directory)
		);
		route(ctx, 'library:duplicateFile', (request) => operations.duplicateFile(request.path));
		route(ctx, 'library:trashFile', (request) => operations.trashFile(request.path));
	}
};
