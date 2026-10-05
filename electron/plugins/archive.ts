// main-archive: the file side of the zip-of-JSON archive (#31). The renderer builds and parses
// the archive's files (src/lib/archive); main only zips them, reads and writes the disk and turns
// an imported document into a design file. Native dialogs: Save for an export and for the file an
// import creates, Open for the archive to read.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from '@neoworks/extension-system';
import type { CreateFromArchiveRequest } from '../bridge';
import { readZip, writeZip, ZipError } from '../archive/zip';
import { IpcError, route } from '../kernel/route';
import { FILE_EXTENSION, FILE_TYPE_NAME } from '../store/constants';
import { hashBytes } from '../store/assetStore';
import { DocumentFile, removeFileAndSidecars } from '../store/documentFile';

export const ARCHIVE_EXTENSION = 'zip';
const ARCHIVE_FILTER = { name: 'Design archive', extensions: [ARCHIVE_EXTENSION] };

function withExtension(file: string, extension: string): string {
	if (path.extname(file).toLowerCase() === `.${extension}`) return file;
	return `${file}.${extension}`;
}

function baseName(name: string): string {
	const base = path.basename(name.replaceAll('\\', '/'));
	if (base === '' || base === '.' || base === '..') return 'Untitled';
	return base;
}

/** Write the design file for an imported archive at `target`, images and fonts included. */
export function createFileFromArchive(target: string, request: CreateFromArchiveRequest): void {
	const file = DocumentFile.create(target, request.document, { overwrite: true });
	try {
		for (const image of request.images) {
			if (hashBytes(image.bytes) !== image.hash) {
				throw new IpcError('INVALID_PAYLOAD', `image ${image.hash} does not match its checksum`);
			}
			file.putAsset(image);
		}
		for (const font of request.fonts) {
			file.embedFont({ family: font.family, style: font.style }, font.bytes);
		}
		file.close();
	} catch (error) {
		// A half-built file would look like a valid but incomplete document.
		file.close();
		removeFileAndSidecars(target);
		throw error;
	}
}

export const mainArchivePlugin: Plugin.Object = {
	name: 'main-archive',
	inject: ['electron', 'ipc', 'store'],
	apply(ctx) {
		route(ctx, 'archive:export', async ({ suggestedName, entries }) => {
			const target = await ctx.electron.dialog.showSaveDialog({
				title: 'Export archive',
				defaultPath: withExtension(baseName(suggestedName), ARCHIVE_EXTENSION),
				filters: [ARCHIVE_FILTER]
			});
			if (target === null) return null;
			const destination = withExtension(target, ARCHIVE_EXTENSION);
			try {
				await writeFile(destination, writeZip(entries));
			} catch (error) {
				if (error instanceof ZipError) throw new IpcError('INVALID_PAYLOAD', error.message);
				throw error;
			}
			return destination;
		});

		route(ctx, 'archive:read', async () => {
			const chosen = await ctx.electron.dialog.showOpenDialog({
				title: 'Import archive',
				defaultPath: ctx.electron.app.getPath('documents'),
				filters: [ARCHIVE_FILTER],
				multiple: false
			});
			if (chosen === null || chosen.length === 0) return null;
			try {
				return { path: chosen[0], entries: readZip(await readFile(chosen[0])) };
			} catch (error) {
				if (error instanceof ZipError) {
					throw new IpcError('HANDLER_FAILED', `Cannot read this archive: ${error.message}`);
				}
				throw error;
			}
		});

		route(ctx, 'archive:create', async (request) => {
			const target = await ctx.electron.dialog.showSaveDialog({
				title: 'Save imported document as',
				defaultPath: withExtension(baseName(request.document.name), FILE_EXTENSION),
				filters: [{ name: FILE_TYPE_NAME, extensions: [FILE_EXTENSION] }]
			});
			if (target === null) return null;
			const destination = withExtension(target, FILE_EXTENSION);
			const resolved = path.resolve(destination);
			if (ctx.store.openPaths().some((open) => path.resolve(open) === resolved)) {
				throw new IpcError('HANDLER_FAILED', `${destination} is open; pick another file name`);
			}
			createFileFromArchive(destination, request);
			return destination;
		});
	}
};
