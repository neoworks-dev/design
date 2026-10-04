// main-app: app lifecycle and the `app:*` IPC routes.
//
// Shutdown: on the first `before-quit` the quit is held back, `app/before-quit` listeners finish
// their work (flushing open documents), the root fiber is disposed (every plugin's effects
// unwind: windows close, handlers are removed), then the app quits for real.

import type { Context, Plugin } from '@neoworks/extension-system';
import { route } from '../kernel/route';

function installLifecycle(ctx: Context): void {
	const { electron, windows } = ctx;

	ctx.effect(() => {
		const quitWhenLastWindowCloses = (): void => {
			if (electron.app.platform !== 'darwin') electron.app.quit();
		};
		electron.app.on('window-all-closed', quitWhenLastWindowCloses);
		return () => electron.app.off('window-all-closed', quitWhenLastWindowCloses);
	}, 'main-app:window-all-closed');

	ctx.effect(() => {
		const focus = (): void => windows.focusMainWindow();
		electron.app.on('second-instance', focus);
		return () => electron.app.off('second-instance', focus);
	}, 'main-app:second-instance');

	ctx.effect(() => {
		let shuttingDown = false;
		const shutDown = (event: { preventDefault(): void }): void => {
			event.preventDefault();
			if (shuttingDown) return;
			shuttingDown = true;
			// Plugins that hold unsaved work (open files) get to finish it before anything unwinds.
			void ctx
				.parallel('app/before-quit')
				.catch((error: unknown) => ctx.logger.error(error))
				.then(() => ctx.root.fiber.dispose())
				.catch((error: unknown) => ctx.logger.error(error))
				.finally(() => electron.app.quit());
		};
		electron.app.on('before-quit', shutDown);
		return () => electron.app.off('before-quit', shutDown);
	}, 'main-app:before-quit');
}

export const mainAppPlugin: Plugin.Object = {
	name: 'main-app',
	inject: ['electron', 'ipc', 'windows'],
	apply(ctx) {
		installLifecycle(ctx);

		route(ctx, 'app:version', () => ctx.electron.app.getVersion());
		route(ctx, 'app:path', (name) => ctx.electron.app.getPath(name));
		route(ctx, 'app:quit', () => {
			ctx.electron.app.quit();
		});
		route(ctx, 'app:bootReport', () => ctx.ipc.bootReport);
	}
};
