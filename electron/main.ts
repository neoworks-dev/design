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
const bundledPluginsDirectory = path.join(distDirectory, '../../plugins');
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

// DESIGN_QA_FIXTURE=0 loads the app without the QA fixture scene, so a session edits a real file.
function entryUrl(): string {
	const base = devServerUrl ? devServerUrl : `${appOrigin}/`;
	if (process.env.DESIGN_QA !== '1' || process.env.DESIGN_QA_FIXTURE !== '0') return base;
	const url = new URL(base);
	url.searchParams.set('fixture', '0');
	return url.toString();
}

async function boot(): Promise<void> {
	const root = createMainContext();
	await bootMainKernel(
		root,
		mainPlugins({
			host: createRealHost(),
			trustedOrigins: trustedOrigins(),
			buildDirectory,
			bundledPluginsDirectory,
			launchPaths: process.argv.slice(1).filter((argument) => argument.endsWith('.ndesign')),
			window: {
				entryUrl: entryUrl(),
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
