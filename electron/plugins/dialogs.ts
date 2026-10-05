// main-dialogs: native open / save dialogs over IPC.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from '@neoworks/extension-system';
import type { PickedImage } from '../bridge';
import { route } from '../kernel/route';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
/** Larger files are skipped: they would not survive the trip over IPC comfortably. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

async function readPicked(files: string[]): Promise<PickedImage[]> {
	const picked: PickedImage[] = [];
	for (const file of files) {
		const bytes = await readFile(file);
		if (bytes.byteLength > MAX_IMAGE_BYTES) continue;
		picked.push({ name: path.basename(file), bytes: new Uint8Array(bytes) });
	}
	return picked;
}

export const mainDialogsPlugin: Plugin.Object = {
	name: 'main-dialogs',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		route(ctx, 'dialogs:openFile', (options) => {
			return ctx.electron.dialog.showOpenDialog({
				...options,
				multiple: options?.multiple === true
			});
		});
		route(ctx, 'dialogs:saveFile', (options) => ctx.electron.dialog.showSaveDialog({ ...options }));
		route(ctx, 'dialogs:openImages', async () => {
			const files = await ctx.electron.dialog.showOpenDialog({
				title: 'Place image',
				filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
				multiple: true
			});
			if (files === null) return null;
			return readPicked(files);
		});
	}
};
