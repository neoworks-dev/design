// Composition root of the main process: pre-ready Electron setup that has no inverse, then the
// main kernel. Everything else (window, protocol, IPC, lifecycle) is a plugin in ./plugins.

import { app, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDebugPaths, isQaSession } from './debug';
import { bootMainKernel } from './kernel/boot';
import { createMainContext } from './kernel/context';
import { createRealHost } from './kernel/realHost';
import { mainPlugins } from './plugins';
import { APP_SCHEME } from './plugins/protocol';

// Compiled output lives in electron/dist, so the project root is two levels up.
const distDirectory = path.dirname(fileURLToPath(import.meta.url));
const buildDirectory = path.join(distDirectory, '../../build');
// Set by `bun run electron:dev`; NODE_ENV is avoided because bun build inlines it.
const devServerUrl = process.env.DEV_SERVER_URL;
const appOrigin = `${APP_SCHEME}://design`;

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
applyDebugPaths();

protocol.registerSchemesAsPrivileged([
	{
		scheme: APP_SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true }
	}
]);

function trustedOrigins(): string[] {
	if (!devServerUrl) return [appOrigin];
	const devUrl = new URL(devServerUrl);
	return [appOrigin, `${devUrl.protocol}//${devUrl.host}`];
}

async function boot(): Promise<void> {
	const root = createMainContext();
	await bootMainKernel(
		root,
		mainPlugins({
			host: createRealHost(),
			trustedOrigins: trustedOrigins(),
			buildDirectory,
			window: {
				entryUrl: devServerUrl ? devServerUrl : `${appOrigin}/`,
				devServer: devServerUrl !== undefined,
				preloadPath: path.join(distDirectory, 'preload.cjs'),
				qaSession: isQaSession
			}
		})
	);
}

// A second instance only focuses the first one; it must not boot a kernel of its own.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	void boot();
}
