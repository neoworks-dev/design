import { FiberState, type Context, type Fiber, type Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { mainPlugins } from '../plugins';
import { mainIpcPlugin } from '../plugins/ipc';
import { bootMainKernel } from './boot';
import { createMainContext } from './context';
import { FakeHost } from './fakeHost';
import { bootTestKernel, settle, testPluginOptions } from './testing';

const brokenPlugin: Plugin.Object = {
	name: 'broken',
	apply() {
		throw new Error('plugin exploded');
	}
};
const needsGhost: Plugin.Object = {
	name: 'needs-ghost',
	inject: ['ghost', 'electron'],
	apply() {}
};

function fiberOf(root: Context, pluginName: string): Fiber {
	for (const runtime of root.registry.values()) {
		if (runtime.name !== pluginName) continue;
		for (const fiber of runtime.fibers) return fiber;
	}
	throw new Error(`plugin not mounted: ${pluginName}`);
}

describe('bootMainKernel', () => {
	it('loads every built-in plugin and reports them', async () => {
		const { report } = await bootTestKernel();
		expect(report.kernel).toBe('main');
		expect(report.failed).toEqual([]);
		expect(report.pending).toEqual([]);
		expect(report.loaded.sort()).toEqual([
			'main-app',
			'main-assets',
			'main-dialogs',
			'main-electron',
			'main-files',
			'main-fonts',
			'main-ipc',
			'main-protocol',
			'main-store',
			'main-window'
		]);
	});

	it('boots plugins listed before the plugins they depend on', async () => {
		const host = new FakeHost();
		const root = createMainContext({ writeLine: () => {} });
		const reversed = [...mainPlugins(testPluginOptions(host))].reverse();
		const report = await bootMainKernel(root, reversed);
		expect(report.loaded).toHaveLength(10);
		expect(report.pending).toEqual([]);
	});

	it('a failing plugin is reported and logged, the others still load', async () => {
		const { report, logLines, host } = await bootTestKernel({ extra: [{ plugin: brokenPlugin }] });
		expect(report.failed).toEqual([{ plugin: 'broken', message: 'plugin exploded' }]);
		expect(report.loaded).toContain('main-window');
		expect(logLines.some((line) => line.includes('plugin exploded'))).toBe(true);
		await settle();
		expect(host.openWindows).toHaveLength(1);
	});

	it('a plugin whose dependency is never provided is reported as pending with the missing service', async () => {
		const { report } = await bootTestKernel({ extra: [{ plugin: needsGhost }] });
		expect(report.pending).toEqual([{ plugin: 'needs-ghost', missing: ['ghost'] }]);
		expect(report.failed).toEqual([]);
	});

	it('rejects invalid plugin config as a failure instead of crashing', async () => {
		const host = new FakeHost();
		const root = createMainContext({ writeLine: () => {} });
		const entries = mainPlugins(testPluginOptions(host)).map((entry) => {
			if (entry.plugin.name !== 'main-ipc') return entry;
			return { ...entry, config: { trustedOrigins: [] } };
		});
		const report = await bootMainKernel(root, entries);
		expect(report.failed).toHaveLength(1);
		expect(report.failed[0].plugin).toBe('main-ipc');
		// everything that needs ipc waits instead of running without its sender policy
		expect(report.pending.map((entry) => entry.plugin).sort()).toEqual([
			'main-app',
			'main-assets',
			'main-dialogs',
			'main-files',
			'main-fonts',
			'main-store',
			'main-window'
		]);
		expect(report.loaded.sort()).toEqual(['main-electron', 'main-protocol']);
	});

	it('publishes the report to open windows and for late pull', async () => {
		const { host, report } = await bootTestKernel();
		await settle();
		const reply = await host.invoke('app:bootReport');
		expect(reply).toEqual({ ok: true, value: report });
		// the window opens after boot: it receives the report through the pull route, and a
		// second publish reaches it as a push
		const window = host.openWindows[0];
		expect(window).toBeDefined();
	});

	it('pushes the report to a window that is already open', async () => {
		const host = new FakeHost();
		const root = createMainContext({ writeLine: () => {} });
		const [electron, ipc, ...rest] = mainPlugins(testPluginOptions(host));
		await bootMainKernel(root, [electron, ipc]);
		const window = host.createWindow({
			width: 1,
			height: 1,
			minWidth: 1,
			minHeight: 1,
			frame: false,
			backgroundColor: '#000',
			preloadPath: ''
		});
		const report = await bootMainKernel(root, rest);
		const pushed = window.sent.filter((message) => message.channel === 'kernel:boot-report');
		expect(pushed).toHaveLength(1);
		expect(pushed[0].payload).toEqual(report);
	});
});

describe('killing a plugin', () => {
	it('does not crash main: the rest keep serving IPC', async () => {
		const { root, host } = await bootTestKernel();
		const fiber = fiberOf(root, 'main-dialogs');
		await fiber.dispose();
		expect(fiber.state).toBe(FiberState.DISPOSED);

		expect(host.handlers.has('dialogs:openFile')).toBe(false);
		expect(host.handlers.has('dialogs:saveFile')).toBe(false);
		expect(await host.invoke('app:version')).toEqual({ ok: true, value: '1.2.3' });
		expect(host.openWindows).toHaveLength(1);
	});

	it('disposing the ipc provider makes its dependants wait, and they recover when it is back', async () => {
		const { root, host } = await bootTestKernel();
		await fiberOf(root, 'main-ipc').dispose();
		await settle();
		expect(host.handlers.size).toBe(0);
		expect(host.openWindows).toHaveLength(0);

		await root.plugin(mainIpcPlugin, { trustedOrigins: ['app://design'] });
		await settle();
		expect(host.handlers.has('app:version')).toBe(true);
		expect(host.openWindows).toHaveLength(1);
	});
});
