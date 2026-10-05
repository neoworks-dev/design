// Test helpers for main-kernel plugins: boot plugins against a FakeHost.

import type { Context } from '@neoworks/extension-system';
import type { BootReport } from '../bridge';
import { mainElectronPlugin } from '../plugins/electron';
import { mainPlugins, type MainPluginOptions } from '../plugins';
import { mainIpcPlugin } from '../plugins/ipc';
import { bootMainKernel, type PluginEntry } from './boot';
import { createMainContext } from './context';
import { FakeHost, type FakeHostOptions, type FakeWindow } from './fakeHost';

export interface TestKernel {
	root: Context;
	host: FakeHost;
	report: BootReport;
	logLines: string[];
}

export const TEST_ORIGIN = 'app://design';

export function testPluginOptions(host: FakeHost): MainPluginOptions {
	return {
		host,
		trustedOrigins: [TEST_ORIGIN],
		buildDirectory: '/fake/build',
		bundledPluginsDirectory: '/fake/bundled-plugins',
		window: {
			entryUrl: `${TEST_ORIGIN}/`,
			devServer: false,
			preloadPath: '/fake/preload.cjs',
			qaSession: false
		}
	};
}

/** Let promise continuations and zero-delay timers run. */
export async function settle(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

async function boot(host: FakeHost, entries: PluginEntry[]): Promise<TestKernel> {
	const logLines: string[] = [];
	const root = createMainContext({ writeLine: (line) => logLines.push(line) });
	const report = await bootMainKernel(root, entries);
	await settle();
	return { root, host, report, logLines };
}

/** The real built-in plugin list, plus optional extra plugins. */
export async function bootTestKernel(
	options: { host?: FakeHostOptions; extra?: PluginEntry[] } = {}
): Promise<TestKernel> {
	const host = new FakeHost(options.host);
	const entries = mainPlugins(testPluginOptions(host));
	if (options.extra) entries.push(...options.extra);
	return boot(host, entries);
}

/** Only `electron` and `ipc` plus `plugins`: for testing a plugin or `route()` in isolation. */
export async function bootMinimalKernel(
	plugins: PluginEntry[],
	hostOptions: FakeHostOptions = {}
): Promise<TestKernel & { window: FakeWindow }> {
	const host = new FakeHost(hostOptions);
	const kernel = await boot(host, [
		{ plugin: mainElectronPlugin, config: { host } },
		{ plugin: mainIpcPlugin, config: { trustedOrigins: [TEST_ORIGIN] } },
		...plugins
	]);
	const window = host.createWindow({
		width: 800,
		height: 600,
		minWidth: 100,
		minHeight: 100,
		frame: false,
		backgroundColor: '#000000',
		preloadPath: '/fake/preload.cjs'
	});
	return { ...kernel, window };
}
