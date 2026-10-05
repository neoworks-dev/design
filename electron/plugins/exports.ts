// main-exports: writes the files of a design export (`exports:write`).
//
// One file asks where to save it (native save dialog); several ask for a folder and are written
// into it. Names are reduced to a base name, so a payload can never write outside the folder the
// user picked. Nothing is written when the dialog is cancelled.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from '@neoworks/extension-system';
import type { ExportFileData } from '../bridge';
import { route } from '../kernel/route';

function baseName(name: string): string {
	const base = path.basename(name.replaceAll('\\', '/'));
	if (base === '' || base === '.' || base === '..') return 'Untitled';
	return base;
}

async function writeAll(directory: string, files: ExportFileData[]): Promise<string[]> {
	const written: string[] = [];
	for (const file of files) {
		const target = path.join(directory, baseName(file.name));
		await writeFile(target, file.bytes);
		written.push(target);
	}
	return written;
}

export const mainExportsPlugin: Plugin.Object = {
	name: 'main-exports',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		route(ctx, 'exports:write', async ({ files }) => {
			if (files.length === 1) {
				const [file] = files;
				const target = await ctx.electron.dialog.showSaveDialog({
					title: 'Export asset',
					defaultPath: baseName(file.name)
				});
				if (target === null) return null;
				await writeFile(target, file.bytes);
				return [target];
			}
			const folders = await ctx.electron.dialog.showOpenDialog({
				title: 'Export assets to folder',
				multiple: false,
				directory: true
			});
			if (folders === null || folders.length === 0) return null;
			return writeAll(folders[0], files);
		});
	}
};
