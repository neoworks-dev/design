// main-dialogs: native open / save dialogs over IPC.

import type { Plugin } from '@neoworks/extension-system';
import { route } from '../kernel/route';

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
	}
};
