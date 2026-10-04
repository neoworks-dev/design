import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { bootMainKernel, type PluginEntry } from '../kernel/boot';
import { createMainContext } from '../kernel/context';
import { FakeHost, type FakeWindow } from '../kernel/fakeHost';
import { mainPlugins } from './index';
import { bootTestKernel, settle, testPluginOptions } from '../kernel/testing';
import { resolveBuildFile } from './protocol';

function fiberOf(root: Context, pluginName: string): ReturnType<Context['plugin']> {
	for (const runtime of root.registry.values()) {
		if (runtime.name !== pluginName) continue;
		for (const fiber of runtime.fibers) return fiber as ReturnType<Context['plugin']>;
	}
	throw new Error(`plugin not mounted: ${pluginName}`);
}

function firstWindow(host: FakeHost): FakeWindow {
	const window = host.openWindows[0];
	if (!window) throw new Error('no window open');
	return window;
}

describe('standard kernel test: mount, assert contributions, dispose, state identical', () => {
	it('every plugin leaves nothing behind when the whole kernel is disposed', async () => {
		const host = new FakeHost();
		const empty = host.snapshot();
		const root = createMainContext({ writeLine: () => {} });
		await bootMainKernel(root, mainPlugins(testPluginOptions(host)));
		await settle();

		const mounted = host.snapshot();
		expect(mounted).not.toEqual(empty);
		expect(mounted.handlers).toContain('window:minimize');
		expect(mounted.handlers).toContain('app:version');
		expect(mounted.handlers).toContain('dialogs:openFile');
		expect(mounted.protocolSchemes).toEqual(['app']);
		expect(mounted.openWindows).toBe(1);

		await root.fiber.dispose();
		await settle();
		expect(host.snapshot()).toEqual(empty);
	});

	const perPlugin: [string, (snapshot: Record<string, unknown>) => void][] = [
		['main-window', (snapshot) => expect(snapshot.handlers).toContain('window:close')],
		['main-app', (snapshot) => expect(snapshot.handlers).toContain('app:quit')],
		['main-dialogs', (snapshot) => expect(snapshot.handlers).toContain('dialogs:saveFile')],
		['main-protocol', (snapshot) => expect(snapshot.protocolSchemes).toEqual(['app'])]
	];

	for (const [name, assertContribution] of perPlugin) {
		it(`${name}: unmounting reverts exactly its own contributions`, async () => {
			const { root, host } = await bootTestKernel();
			const before = host.snapshot();
			assertContribution(before);

			await fiberOf(root, name).dispose();
			await settle();
			const after = host.snapshot();
			expect(after).not.toEqual(before);

			// remount from the same plugin list: state is identical to the first mount
			const entry = mainPlugins(testPluginOptions(host)).find((item) => item.plugin.name === name);
			if (!entry) throw new Error(`no plugin entry for ${name}`);
			await root.plugin(entry.plugin, entry.config);
			await settle();
			expect(host.snapshot()).toEqual(before);
		});
	}
});

describe('main-window', () => {
	it('opens one frameless window with the preload once the app is ready', async () => {
		const { host } = await bootTestKernel({ host: { deferReady: true } });
		expect(host.openWindows).toHaveLength(0);
		host.becomeReady();
		await settle();
		const window = firstWindow(host);
		expect(host.openWindows).toHaveLength(1);
		expect(window.options).toMatchObject({ frame: false, preloadPath: '/fake/preload.cjs' });
		expect(window.loadedUrls).toEqual(['app://design/']);
	});

	it('does not open a window if the plugin unloads before the app is ready', async () => {
		const { host, root } = await bootTestKernel({ host: { deferReady: true } });
		await root.fiber.dispose();
		host.becomeReady();
		await settle();
		expect(host.openWindows).toHaveLength(0);
	});

	it('closes its window on unload', async () => {
		const { host, root } = await bootTestKernel();
		const window = firstWindow(host);
		await fiberOf(root, 'main-window').dispose();
		expect(window.destroyed).toBe(true);
		expect(host.openWindows).toHaveLength(0);
	});

	it('serves the window routes for the sender window', async () => {
		const { host } = await bootTestKernel();
		const window = firstWindow(host);
		await host.invoke('window:minimize');
		expect(window.minimized).toBe(true);
		expect(await host.invoke('window:toggleMaximize')).toEqual({ ok: true, value: true });
		expect(window.maximized).toBe(true);
		expect(await host.invoke('window:toggleMaximize')).toEqual({ ok: true, value: false });
		await host.invoke('window:close');
		expect(window.destroyed).toBe(true);
	});

	it('pushes maximize changes to the renderer', async () => {
		const { host } = await bootTestKernel();
		const window = firstWindow(host);
		window.maximize();
		window.unmaximize();
		const pushes = window.sent.filter((message) => message.channel === 'window:maximized');
		expect(pushes.map((message) => message.payload)).toEqual([true, false]);
	});

	it('opens only http(s) links in the system browser, never inside the app', async () => {
		const { host } = await bootTestKernel();
		const window = firstWindow(host);
		window.newWindowHandler?.('https://example.com/docs');
		window.newWindowHandler?.('http://example.com');
		window.newWindowHandler?.('file:///etc/passwd');
		window.newWindowHandler?.('javascript:alert(1)');
		expect(host.openedExternal).toEqual(['https://example.com/docs', 'http://example.com']);
	});

	it('reopens a window on activate when none is left, and not otherwise', async () => {
		const { host } = await bootTestKernel();
		host.emitAppEvent('activate');
		await settle();
		expect(host.openWindows).toHaveLength(1);
		firstWindow(host).close();
		host.emitAppEvent('activate');
		await settle();
		expect(host.openWindows).toHaveLength(1);
	});

	it('retries loading the dev server while it boots, and stops on unload', async () => {
		const host = new FakeHost();
		const original = host.createWindow;
		host.createWindow = (options) => {
			const window = original(options);
			window.loadFailuresRemaining = 2;
			return window;
		};
		const root = createMainContext({ writeLine: () => {} });
		const options = testPluginOptions(host);
		options.window = { ...options.window, entryUrl: 'http://localhost:5173', devServer: true };
		options.trustedOrigins = ['app://design', 'http://localhost:5173'];
		await bootMainKernel(root, mainPlugins(options));
		await new Promise<void>((resolve) => setTimeout(resolve, 1200));
		const window = firstWindow(host);
		expect(window.loadedUrls).toEqual(Array(3).fill('http://localhost:5173'));
		expect(window.devToolsOpened).toBe(true);
		await root.fiber.dispose();
	});

	it('mirrors the renderer console only in a QA session', async () => {
		const host = new FakeHost();
		const root = createMainContext({ writeLine: () => {} });
		const options = testPluginOptions(host);
		options.window = { ...options.window, qaSession: true };
		await bootMainKernel(root, mainPlugins(options));
		await settle();
		const window = firstWindow(host);
		expect(window.observers.size).toBe(1);
		await root.fiber.dispose();
		expect(window.observers.size).toBe(0);

		const plain = await bootTestKernel();
		expect(firstWindow(plain.host).observers.size).toBe(0);
	});
});

describe('main-protocol', () => {
	it('registers the app:// handler after ready and fetches the requested build file', async () => {
		const { host } = await bootTestKernel({ host: { deferReady: true } });
		expect(host.protocolHandlers.size).toBe(0);
		host.becomeReady();
		await settle();
		const handler = host.protocolHandlers.get('app');
		expect(handler).toBeDefined();
		await handler?.({ url: 'app://design/unknown/route' });
		expect(host.fetched).toHaveLength(1);
		expect(host.fetched[0]).toMatch(/^file:\/\/\/fake\/build\/200\.html$/);
	});

	it('does not touch the protocol if unloaded before ready', async () => {
		const { host, root } = await bootTestKernel({ host: { deferReady: true } });
		await root.fiber.dispose();
		host.becomeReady();
		await settle();
		expect(host.protocolHandlers.size).toBe(0);
	});

	it('resolveBuildFile falls back to 200.html and refuses to leave the build directory', () => {
		expect(resolveBuildFile('/fake/build', '/')).toBe('/fake/build/200.html');
		expect(resolveBuildFile('/fake/build', '/../../etc/passwd')).toBe('/fake/build/200.html');
		expect(resolveBuildFile('/fake/build', '/%2e%2e/%2e%2e/etc/passwd')).toBe(
			'/fake/build/200.html'
		);
	});
});

describe('main-app', () => {
	it('serves version, paths and the quit route', async () => {
		const { host } = await bootTestKernel();
		expect(await host.invoke('app:version')).toEqual({ ok: true, value: '1.2.3' });
		expect(await host.invoke('app:path', 'documents')).toEqual({
			ok: true,
			value: '/fake/documents'
		});
		await host.invoke('app:quit');
		expect(host.quitCount).toBe(1);
	});

	it('quits when the last window closes, except on macOS', async () => {
		const linux = await bootTestKernel();
		linux.host.emitAppEvent('window-all-closed');
		expect(linux.host.quitCount).toBe(1);

		const mac = await bootTestKernel({ host: { platform: 'darwin' } });
		mac.host.emitAppEvent('window-all-closed');
		expect(mac.host.quitCount).toBe(0);
	});

	it('focuses (and restores) the main window when a second instance starts', async () => {
		const { host } = await bootTestKernel();
		const window = firstWindow(host);
		window.minimized = true;
		host.emitAppEvent('second-instance', []);
		expect(window.minimized).toBe(false);
		expect(window.focusCount).toBe(1);
	});

	describe('clean shutdown', () => {
		it('holds the first quit, disposes the root fiber, then quits for real', async () => {
			const { host } = await bootTestKernel();
			const window = firstWindow(host);
			let prevented = 0;
			host.emitAppEvent('before-quit', {
				preventDefault: () => {
					prevented += 1;
				}
			});
			expect(prevented).toBe(1);
			expect(host.quitCount).toBe(0);
			await settle();

			expect(host.quitCount).toBe(1);
			expect(window.destroyed).toBe(true);
			expect(host.snapshot()).toEqual(new FakeHost().snapshot());
			// the listener is gone, so Electron's second before-quit is not held back
			expect(host.appListeners.get('before-quit')?.size ?? 0).toBe(0);
		});

		it('a repeated before-quit during shutdown does not start a second shutdown', async () => {
			const { host } = await bootTestKernel();
			const event = { preventDefault: () => {} };
			host.emitAppEvent('before-quit', event);
			host.emitAppEvent('before-quit', event);
			await settle();
			expect(host.quitCount).toBe(1);
		});
	});
});

describe('main-dialogs', () => {
	it('opens with the requested options and returns the paths', async () => {
		const { host } = await bootTestKernel();
		host.openDialogResult = ['/a.ndesign', '/b.ndesign'];
		const reply = await host.invoke('dialogs:openFile', {
			title: 'Open',
			multiple: true,
			filters: [{ name: 'Designs', extensions: ['ndesign'] }]
		});
		expect(reply).toEqual({ ok: true, value: ['/a.ndesign', '/b.ndesign'] });
		expect(host.lastOpenDialogRequest).toEqual({
			title: 'Open',
			multiple: true,
			filters: [{ name: 'Designs', extensions: ['ndesign'] }]
		});
	});

	it('defaults to a single selection, and returns null when cancelled', async () => {
		const { host } = await bootTestKernel();
		expect(await host.invoke('dialogs:openFile')).toEqual({ ok: true, value: null });
		expect(host.lastOpenDialogRequest?.multiple).toBe(false);
		host.saveDialogResult = '/out.ndesign';
		expect(await host.invoke('dialogs:saveFile', { defaultPath: '/out.ndesign' })).toEqual({
			ok: true,
			value: '/out.ndesign'
		});
	});
});

describe('plugin shape rules', () => {
	const entries: PluginEntry[] = mainPlugins(testPluginOptions(new FakeHost()));

	it('every main plugin has a name and every IPC plugin injects electron and ipc', () => {
		for (const { plugin } of entries) {
			expect(plugin.name).toMatch(/^main-/);
		}
		const withRoutes = entries.filter((entry) =>
			['main-window', 'main-app', 'main-dialogs', 'main-store', 'main-files'].includes(
				entry.plugin.name as string
			)
		);
		for (const { plugin } of withRoutes) {
			const inject = (plugin as Plugin.Object).inject as string[];
			expect(inject).toEqual(expect.arrayContaining(['electron', 'ipc']));
		}
	});
});
