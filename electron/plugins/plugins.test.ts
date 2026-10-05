import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootMainKernel, type PluginEntry } from '../kernel/boot';
import { createMainContext } from '../kernel/context';
import { FakeHost, type FakeWindow } from '../kernel/fakeHost';
import { mainPlugins } from './index';
import { bootTestKernel, settle, testPluginOptions } from '../kernel/testing';
import { forcedContentType, resolveBuildFile } from './protocol';

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
		['main-dialogs', (snapshot) => expect(snapshot.handlers).toContain('dialogs:openImages')],
		['main-fonts', (snapshot) => expect(snapshot.handlers).toContain('fonts:load')],
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

	it('mirrors the renderer console only in a QA session (diagnostics always observes)', async () => {
		const host = new FakeHost();
		const root = createMainContext({ writeLine: () => {} });
		const options = testPluginOptions(host);
		options.window = { ...options.window, qaSession: true };
		await bootMainKernel(root, mainPlugins(options));
		await settle();
		const window = firstWindow(host);
		expect(window.loadedUrls).toEqual(['app://design/?qa=1']);
		expect(window.observers.size).toBe(2);
		await root.fiber.dispose();
		expect(window.observers.size).toBe(0);

		const plain = await bootTestKernel();
		expect(firstWindow(plain.host).observers.size).toBe(1);
	});
});

describe('main-window state', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function savedState(host: FakeHost): unknown {
		const text = host.files.get('window-state.json');
		if (text === undefined) return undefined;
		return JSON.parse(text);
	}

	it('opens at the default size when nothing was saved', async () => {
		const { host } = await bootTestKernel();
		const window = firstWindow(host);
		expect(window.options).toMatchObject({ width: 1440, height: 900 });
		expect(window.options.x).toBeUndefined();
		expect(window.maximized).toBe(false);
	});

	it('restores the saved size and position', async () => {
		const files = {
			'window-state.json': '{"x":40,"y":30,"width":1200,"height":760,"maximized":false}'
		};
		const { host } = await bootTestKernel({ host: { files } });
		expect(firstWindow(host).options).toMatchObject({ x: 40, y: 30, width: 1200, height: 760 });
	});

	it('restores a maximized window', async () => {
		const files = {
			'window-state.json': '{"x":0,"y":0,"width":1200,"height":760,"maximized":true}'
		};
		const { host } = await bootTestKernel({ host: { files } });
		expect(firstWindow(host).maximized).toBe(true);
	});

	it('drops a position on a monitor that is no longer connected, and fits the size', async () => {
		const files = {
			'window-state.json': '{"x":3000,"y":100,"width":2400,"height":1400,"maximized":false}'
		};
		const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
		const { host } = await bootTestKernel({ host: { files, displays } });
		const { options } = firstWindow(host);
		expect(options.x).toBeUndefined();
		expect(options).toMatchObject({ width: 1920, height: 1080 });
	});

	it('ignores a broken state file', async () => {
		const { host } = await bootTestKernel({ host: { files: { 'window-state.json': '{nope' } } });
		expect(firstWindow(host).options).toMatchObject({ width: 1440, height: 900 });
	});

	it('saves bounds debounced after resize and move, once', async () => {
		const { host } = await bootTestKernel();
		vi.useFakeTimers();
		const window = firstWindow(host);
		window.resizeTo({ x: 10, y: 10, width: 1000, height: 700 });
		window.resizeTo({ x: 20, y: 20, width: 1100, height: 720 });
		expect(savedState(host)).toBeUndefined();
		await vi.advanceTimersByTimeAsync(500);
		expect(savedState(host)).toEqual({ x: 20, y: 20, width: 1100, height: 720, maximized: false });
	});

	it('saves the maximized state with the restored bounds', async () => {
		const { host } = await bootTestKernel();
		vi.useFakeTimers();
		const window = firstWindow(host);
		window.maximize();
		await vi.advanceTimersByTimeAsync(500);
		expect(savedState(host)).toMatchObject({ width: 1440, height: 900, maximized: true });
	});

	it('saves immediately when the window closes', async () => {
		const { host } = await bootTestKernel();
		vi.useFakeTimers();
		const window = firstWindow(host);
		window.resizeTo({ x: 5, y: 6, width: 1300, height: 800 });
		window.close();
		expect(savedState(host)).toEqual({ x: 5, y: 6, width: 1300, height: 800, maximized: false });
		await vi.advanceTimersByTimeAsync(500);
		expect(savedState(host)).toEqual({ x: 5, y: 6, width: 1300, height: 800, maximized: false });
	});

	it('does not save a minimized window', async () => {
		const { host } = await bootTestKernel();
		vi.useFakeTimers();
		const window = firstWindow(host);
		window.minimized = true;
		window.resizeTo({ x: 0, y: 0, width: 1000, height: 700 });
		await vi.advanceTimersByTimeAsync(500);
		expect(savedState(host)).toBeUndefined();
	});

	it('unloading saves once, removes every listener and cancels the pending save', async () => {
		const { host, root } = await bootTestKernel();
		vi.useFakeTimers();
		const window = firstWindow(host);
		window.resizeTo({ x: 1, y: 2, width: 1250, height: 810 });
		await fiberOf(root, 'main-window').dispose();
		expect(savedState(host)).toEqual({ x: 1, y: 2, width: 1250, height: 810, maximized: false });

		expect(vi.getTimerCount()).toBe(0);
		for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'close', 'closed'] as const) {
			expect(window.listenerCount(event)).toBe(0);
		}
	});

	it('mounting again after unmounting restores what unloading saved', async () => {
		const { host, root } = await bootTestKernel();
		firstWindow(host).resizeTo({ x: 7, y: 8, width: 1111, height: 777 });
		await fiberOf(root, 'main-window').dispose();
		await settle();
		const entry = mainPlugins(testPluginOptions(host)).find(
			(item) => item.plugin.name === 'main-window'
		);
		if (!entry) throw new Error('no main-window entry');
		await root.plugin(entry.plugin, entry.config);
		await settle();
		expect(firstWindow(host).options).toMatchObject({ x: 7, y: 8, width: 1111, height: 777 });
	});

	it('keeps macOS traffic lights and is frameless elsewhere', async () => {
		const mac = await bootTestKernel({ host: { platform: 'darwin' } });
		expect(firstWindow(mac.host).options).toMatchObject({ frame: true, titleBarStyle: 'hidden' });
		const linux = await bootTestKernel();
		expect(firstWindow(linux.host).options.frame).toBe(false);
		expect(firstWindow(linux.host).options.titleBarStyle).toBeUndefined();
	});

	it('answers window:isMaximized for the sender window', async () => {
		const { host } = await bootTestKernel();
		expect(await host.invoke('window:isMaximized')).toEqual({ ok: true, value: false });
		firstWindow(host).maximize();
		expect(await host.invoke('window:isMaximized')).toEqual({ ok: true, value: true });
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

	it('serves wasm files as application/wasm so streaming compilation accepts them', async () => {
		const { host } = await bootTestKernel({ host: { deferReady: true } });
		host.becomeReady();
		await settle();
		const handler = host.protocolHandlers.get('app');
		const response = await handler?.({ url: 'app://design/200.html' });
		expect(response?.headers.get('content-type')).not.toBe('application/wasm');
		expect(forcedContentType('/build/_app/immutable/assets/canvaskit.abc123.wasm')).toBe(
			'application/wasm'
		);
		expect(forcedContentType('/build/200.html')).toBeUndefined();
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
