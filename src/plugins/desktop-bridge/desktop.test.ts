import { Context, FiberState, type Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../../../electron/bridge';
import { createBrowserBridge, type BrowserBridge } from '../../lib/desktop/browserBridge';
import { DesktopError, DesktopService, parseBridgeError } from './desktop';
import desktopBridgePlugin, { resolveBridge } from './index';

// A consumer plugin, the way other plugins use the service: inject it, subscribe through it.
function consumer(use: (desktop: DesktopService) => void, name = 'consumer'): Plugin.Object {
	return {
		name,
		inject: ['desktop'],
		apply(ctx) {
			use(ctx.desktop);
		}
	};
}

function observableState(root: Context, bridge: BrowserBridge): Record<string, unknown> {
	return {
		desktopProvided: root.reflect.get('desktop') !== undefined,
		subscribers: bridge.subscriberCount(),
		fibers: [...root.registry.values()].reduce((total, runtime) => total + runtime.fibers.length, 0)
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('desktop-bridge plugin', () => {
	it('mounts, provides the desktop service, and unmounts leaving state identical', async () => {
		const root = new Context();
		const bridge = createBrowserBridge();
		const before = observableState(root, bridge);

		const fiber = root.plugin(desktopBridgePlugin, { bridge });
		await fiber;
		expect(fiber.state).toBe(FiberState.ACTIVE);
		expect(root.reflect.get('desktop')).toBeInstanceOf(DesktopService);
		expect(fiber.ctx.fiber.getEffects().map((effect) => effect.label)).toContain(
			'ctx.provide("desktop")'
		);

		await fiber.dispose();
		expect(observableState(root, bridge)).toEqual(before);
	});

	it('a consumer waits for the service and unwinds when the service goes away', async () => {
		const root = new Context();
		const bridge = createBrowserBridge();
		let version = '';
		const user = root.plugin(
			consumer((desktop) => {
				void desktop.version().then((value) => (version = value));
			})
		);
		await user;
		expect(user.state).toBe(FiberState.PENDING);

		const provider = root.plugin(desktopBridgePlugin, { bridge });
		await provider;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(user.state).toBe(FiberState.ACTIVE);
		expect(version).toBe('0.0.0-browser');

		await provider.dispose();
		expect(user.state).toBe(FiberState.PENDING);
	});

	it('removes subscriptions when the subscribing plugin unmounts', async () => {
		const root = new Context();
		const bridge = createBrowserBridge();
		await root.plugin(desktopBridgePlugin, { bridge });
		const received: boolean[] = [];

		const subscriber = root.plugin(
			consumer((desktop) => {
				desktop.on('window:maximized', (value) => received.push(value));
				desktop.on('kernel:boot-report', () => {});
			})
		);
		await subscriber;
		expect(bridge.subscriberCount()).toBe(2);

		bridge.emit('window:maximized', true);
		expect(received).toEqual([true]);

		await subscriber.dispose();
		expect(bridge.subscriberCount()).toBe(0);
		bridge.emit('window:maximized', false);
		expect(received).toEqual([true]);
	});

	it('attaches the subscription to the caller, not to the provider', async () => {
		const root = new Context();
		const bridge = createBrowserBridge();
		const provider = root.plugin(desktopBridgePlugin, { bridge });
		await provider;
		const subscriber = root.plugin(
			consumer((desktop) => {
				desktop.on('window:maximized', () => {});
			})
		);
		await subscriber;
		const labels = (fiber: typeof provider): string[] =>
			fiber.ctx.fiber.getEffects().map((effect) => effect.label);
		expect(labels(subscriber)).toContain('desktop:on:window:maximized');
		expect(labels(provider)).not.toContain('desktop:on:window:maximized');
	});

	it('the returned function unsubscribes early, and only once', async () => {
		const root = new Context();
		const bridge = createBrowserBridge();
		await root.plugin(desktopBridgePlugin, { bridge });
		let stop: () => Promise<void> = async () => {};
		const subscriber = root.plugin(
			consumer((desktop) => {
				stop = desktop.on('window:maximized', () => {});
			})
		);
		await subscriber;
		expect(bridge.subscriberCount()).toBe(1);
		await stop();
		await stop();
		expect(bridge.subscriberCount()).toBe(0);
		await subscriber.dispose();
		expect(bridge.subscriberCount()).toBe(0);
	});
});

describe('DesktopService', () => {
	async function mount(bridge: DesktopBridge): Promise<DesktopService> {
		const root = new Context();
		await root.plugin(desktopBridgePlugin, { bridge });
		const service = root.reflect.get('desktop');
		if (!(service instanceof DesktopService)) throw new Error('desktop service missing');
		return service;
	}

	it('forwards every call to the bridge', async () => {
		const bridge = createBrowserBridge();
		const calls: string[] = [];
		const spied: DesktopBridge = {
			...bridge,
			window: {
				minimize: () => {
					calls.push('minimize');
					return bridge.window.minimize();
				},
				toggleMaximize: () => bridge.window.toggleMaximize(),
				close: () => {
					calls.push('close');
					return bridge.window.close();
				}
			},
			app: {
				...bridge.app,
				path: (name) => {
					calls.push(`path:${name}`);
					return bridge.app.path(name);
				}
			}
		};
		const desktop = await mount(spied);
		await desktop.minimizeWindow();
		await desktop.closeWindow();
		expect(await desktop.path('userData')).toBe('/browser/userData');
		expect(await desktop.toggleMaximizeWindow()).toBe(true);
		expect(await desktop.toggleMaximizeWindow()).toBe(false);
		expect(calls).toEqual(['minimize', 'close', 'path:userData']);
		expect(await desktop.version()).toBe('0.0.0-browser');
		expect(await desktop.openFileDialog()).toBeNull();
		expect(await desktop.saveFileDialog()).toBeNull();
		expect(await desktop.mainBootReport()).toMatchObject({ kernel: 'main' });
		expect(desktop.platform).toBe(bridge.system.platform);
	});

	it('forwards the store calls and rebuilds their errors', async () => {
		const bridge = createBrowserBridge();
		const calls: string[] = [];
		const info = {
			path: '/a.ndesign',
			documentId: 'd',
			name: 'a',
			schemaVersion: 1,
			createdAt: 1,
			modifiedAt: 2,
			recovered: false,
			unsaved: false,
			untitled: false
		};
		bridge.store = {
			open: (path) => {
				calls.push(`open:${path}`);
				return Promise.resolve(info);
			},
			create: (request) => {
				calls.push(`create:${request.path}`);
				return Promise.resolve(info);
			},
			load: () => Promise.reject(new Error('HANDLER_FAILED: /a.ndesign is damaged')),
			close: () => {
				calls.push('close');
				return Promise.resolve();
			},
			commit: (transactions) => {
				calls.push(`commit:${transactions.length}`);
				return Promise.resolve({ committed: transactions.length, documentRows: 0 });
			},
			checkpoint: () => {
				calls.push('checkpoint');
				return Promise.resolve(info);
			}
		};
		const desktop = await mount(bridge);
		expect(await desktop.storeOpen('/a.ndesign')).toBe(info);
		expect(await desktop.storeCreate({ path: '/b.ndesign' })).toBe(info);
		expect(await desktop.storeCommit([])).toEqual({ committed: 0, documentRows: 0 });
		expect(await desktop.storeCheckpoint()).toBe(info);
		await desktop.storeClose();
		expect(calls).toEqual([
			'open:/a.ndesign',
			'create:/b.ndesign',
			'commit:0',
			'checkpoint',
			'close'
		]);
		const error = await desktop.storeLoad().catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: 'HANDLER_FAILED', message: '/a.ndesign is damaged' });
	});

	it('turns the bridge error message back into a typed DesktopError', async () => {
		const bridge = createBrowserBridge();
		bridge.app.path = () => Promise.reject(new Error('INVALID_PAYLOAD: expected one of userData'));
		const desktop = await mount(bridge);
		const error = await desktop.path('userData').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(DesktopError);
		expect(error).toMatchObject({ code: 'INVALID_PAYLOAD', message: 'expected one of userData' });
	});

	it('lets unrelated errors through unchanged', async () => {
		const bridge = createBrowserBridge();
		const failure = new Error('network down: really');
		bridge.app.version = () => Promise.reject(failure);
		const desktop = await mount(bridge);
		await expect(desktop.version()).rejects.toBe(failure);
	});

	it('parseBridgeError recognises exactly the known codes', () => {
		expect(parseBridgeError(new Error('FORBIDDEN_SENDER: nope'))).toMatchObject({
			code: 'FORBIDDEN_SENDER',
			message: 'nope'
		});
		expect(parseBridgeError(new Error('HANDLER_FAILED: a: b'))).toMatchObject({
			message: 'a: b'
		});
		expect(parseBridgeError(new Error('SOMETHING_ELSE: x'))).toBeNull();
		expect(parseBridgeError(new Error('no separator'))).toBeNull();
		expect(parseBridgeError('a string')).toBeNull();
	});
});

describe('browser fallback', () => {
	it('is used when there is no window.desktop, so the app boots without Electron', async () => {
		vi.stubGlobal('window', {});
		const root = new Context();
		const fiber = root.plugin(desktopBridgePlugin);
		await fiber;
		expect(fiber.state).toBe(FiberState.ACTIVE);
		const desktop = root.reflect.get('desktop');
		expect(desktop).toBeInstanceOf(DesktopService);
		if (!(desktop instanceof DesktopService)) return;
		expect(await desktop.version()).toBe('0.0.0-browser');
	});

	it('is used when there is no window at all (node, workers)', () => {
		vi.stubGlobal('window', undefined);
		expect(resolveBridge().system.arch).toBe('browser');
	});

	it('prefers the preload bridge when present', () => {
		const injected = createBrowserBridge();
		vi.stubGlobal('window', { desktop: injected });
		expect(resolveBridge()).toBe(injected);
	});

	it('behaves like a bridge: window flag, in-memory events, cancelled dialogs', async () => {
		const bridge = createBrowserBridge();
		expect(await bridge.window.toggleMaximize()).toBe(true);
		const seen: string[] = [];
		const off = bridge.events.on('kernel:boot-report', (report) => seen.push(report.kernel));
		bridge.emit('kernel:boot-report', { kernel: 'main', loaded: [], failed: [], pending: [] });
		off();
		bridge.emit('kernel:boot-report', { kernel: 'renderer', loaded: [], failed: [], pending: [] });
		expect(seen).toEqual(['main']);
		expect(await bridge.dialogs.openFile({ multiple: true })).toBeNull();
	});
});
