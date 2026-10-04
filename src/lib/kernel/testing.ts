// Test helper for plugins (not shipped). The standard test of every plugin is: build a root
// context with the providers it needs, take a snapshot, mount the plugin, assert its contribution,
// dispose it, and assert the observable state equals the snapshot from before mounting.
//
//   describePlugin('core-regions', coreRegions, {
//   	contributes: ({ ctx }) => expect(ctx.regions).toBeDefined()
//   })
//
// "Observable state" (see `snapshotState`):
//   - every registry reachable from a provided service (ids of all entries),
//   - kernel event listener counts per event name,
//   - the labelled effect tree of the root fiber,
//   - DOM listeners added to window/document/globalThis and still attached,
//   - timers (setTimeout/setInterval) still pending,
//   - handlers on the fake `ipcMain`, if one is passed.
// Works for renderer and main plugins alike, because both are plugins on a `Context`.

import { Context, type EffectMeta, type Fiber, type Plugin } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../../../electron/bridge';
import { Registry } from '../registries/registry.svelte';

export interface FakeDesktop {
	bridge: DesktopBridge;
	/** Names of bridge calls in the order they happened, for example `window.minimize`. */
	calls: string[];
	/** Restore `window.desktop` to what it was before `installFakeDesktop`. */
	restore: () => void;
}

/** Fake `window.desktop` bridge for renderer plugins. Installs itself on `window`. */
export function installFakeDesktop(overrides: Partial<DesktopBridge> = {}): FakeDesktop {
	const calls: string[] = [];
	const bridge: DesktopBridge = {
		window: {
			minimize: vi.fn(() => {
				calls.push('window.minimize');
				return Promise.resolve();
			}),
			toggleMaximize: vi.fn(() => {
				calls.push('window.toggleMaximize');
				return Promise.resolve(true);
			}),
			close: vi.fn(() => {
				calls.push('window.close');
				return Promise.resolve();
			})
		},
		system: { platform: 'linux', arch: 'x64' },
		...overrides
	};
	const previous = Reflect.get(globalThis, 'desktop');
	Reflect.set(globalThis, 'desktop', bridge);
	return {
		bridge,
		calls,
		restore: () => Reflect.set(globalThis, 'desktop', previous)
	};
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

/** Fake `ipcMain` for main-kernel plugins: `handle` / `removeHandler` bookkeeping only. */
export class FakeIpcMain {
	readonly handlers = new Map<string, IpcHandler>();

	handle(channel: string, handler: IpcHandler): void {
		if (this.handlers.has(channel)) throw new Error(`second handler for "${channel}"`);
		this.handlers.set(channel, handler);
	}

	removeHandler(channel: string): void {
		this.handlers.delete(channel);
	}

	invoke(channel: string, ...args: unknown[]): Promise<unknown> {
		const handler = this.handlers.get(channel);
		if (!handler) return Promise.reject(new Error(`no handler for "${channel}"`));
		return Promise.resolve(handler({}, ...args));
	}
}

interface TrackedListener {
	target: string;
	type: string;
	listener: unknown;
}

/**
 * Spies on the global side-effect APIs a plugin must wrap in `ctx.effect`: DOM listeners on
 * window/document/globalThis and timers.
 */
export class EnvironmentTracker {
	#listeners: TrackedListener[] = [];
	#timers = new Set<unknown>();
	#restorers: (() => void)[] = [];

	install(): void {
		this.#spyOnTarget('window', globalThis);
		if (typeof document !== 'undefined') this.#spyOnTarget('document', document);
		this.#spyOnTimers();
	}

	uninstall(): void {
		this.#restorers.reverse().forEach((restore) => restore());
		this.#restorers = [];
	}

	snapshot(): { domListeners: Record<string, number>; timers: number } {
		const domListeners: Record<string, number> = {};
		for (const entry of this.#listeners) {
			const key = `${entry.target}:${entry.type}`;
			domListeners[key] = (domListeners[key] || 0) + 1;
		}
		return { domListeners, timers: this.#timers.size };
	}

	#spyOnTarget(name: string, target: EventTarget): void {
		const originalAdd = target.addEventListener.bind(target);
		const originalRemove = target.removeEventListener.bind(target);
		const addSpy = (type: string, listener: unknown, options?: unknown): void => {
			const exists = this.#listeners.some(
				(entry) => entry.target === name && entry.type === type && entry.listener === listener
			);
			if (!exists) this.#listeners.push({ target: name, type, listener });
			originalAdd(type, listener as EventListener, options as AddEventListenerOptions);
		};
		const removeSpy = (type: string, listener: unknown, options?: unknown): void => {
			this.#listeners = this.#listeners.filter(
				(entry) => !(entry.target === name && entry.type === type && entry.listener === listener)
			);
			originalRemove(type, listener as EventListener, options as EventListenerOptions);
		};
		const previousAdd = Object.getOwnPropertyDescriptor(target, 'addEventListener');
		const previousRemove = Object.getOwnPropertyDescriptor(target, 'removeEventListener');
		Object.defineProperty(target, 'addEventListener', { value: addSpy, configurable: true });
		Object.defineProperty(target, 'removeEventListener', { value: removeSpy, configurable: true });
		this.#restorers.push(() => {
			restoreProperty(target, 'addEventListener', previousAdd);
			restoreProperty(target, 'removeEventListener', previousRemove);
		});
	}

	#spyOnTimers(): void {
		const originalSetTimeout = globalThis.setTimeout;
		const originalClearTimeout = globalThis.clearTimeout;
		const originalSetInterval = globalThis.setInterval;
		const originalClearInterval = globalThis.clearInterval;
		const timers = this.#timers;

		const trackedSetTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
			const handle: unknown = originalSetTimeout(
				() => {
					timers.delete(handle);
					callback();
				},
				delay,
				...args
			);
			timers.add(handle);
			return handle;
		}) as typeof setTimeout;
		const trackedSetInterval = ((callback: () => void, delay?: number, ...args: unknown[]) => {
			const handle: unknown = originalSetInterval(callback, delay, ...args);
			timers.add(handle);
			return handle;
		}) as typeof setInterval;
		const trackedClearTimeout = (handle?: Parameters<typeof clearTimeout>[0]): void => {
			timers.delete(handle);
			originalClearTimeout(handle);
		};
		const trackedClearInterval = (handle?: Parameters<typeof clearInterval>[0]): void => {
			timers.delete(handle);
			originalClearInterval(handle);
		};

		globalThis.setTimeout = trackedSetTimeout;
		globalThis.setInterval = trackedSetInterval;
		globalThis.clearTimeout = trackedClearTimeout;
		globalThis.clearInterval = trackedClearInterval;
		this.#restorers.push(() => {
			globalThis.setTimeout = originalSetTimeout;
			globalThis.setInterval = originalSetInterval;
			globalThis.clearTimeout = originalClearTimeout;
			globalThis.clearInterval = originalClearInterval;
		});
	}
}

function restoreProperty(
	target: object,
	key: string,
	descriptor: PropertyDescriptor | undefined
): void {
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
		return;
	}
	Reflect.deleteProperty(target, key);
}

export interface StateSnapshot {
	/** `<service>.<field>` to the ids of every entry of that registry. */
	registries: Record<string, string[]>;
	/** Extra state of services that implement `snapshotState()`. */
	services: Record<string, unknown>;
	/** Kernel event name to listener count. */
	listeners: Record<string, number>;
	effects: EffectMeta[];
	domListeners: Record<string, number>;
	timers: number;
	ipcHandlers: string[];
}

export interface SnapshotSources {
	tracker?: EnvironmentTracker;
	ipcMain?: FakeIpcMain;
}

interface SnapshotableService {
	snapshotState(): unknown;
}

function isSnapshotable(value: unknown): value is SnapshotableService {
	if (typeof value !== 'object' || value === null) return false;
	return typeof Reflect.get(value, 'snapshotState') === 'function';
}

/** Observable state of `ctx`; two snapshots are equal when nothing was left behind. */
export function snapshotState(ctx: Context, sources: SnapshotSources = {}): StateSnapshot {
	const environment = sources.tracker?.snapshot() ?? { domListeners: {}, timers: 0 };
	const snapshot: StateSnapshot = {
		registries: {},
		services: {},
		listeners: countListeners(ctx),
		effects: ctx.root.fiber.getEffects(),
		domListeners: environment.domListeners,
		timers: environment.timers,
		ipcHandlers: [...(sources.ipcMain?.handlers.keys() ?? [])].sort()
	};
	const store = ctx.root.reflect.store;
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		collectServiceState(snapshot, impl.name, impl.value);
	}
	return snapshot;
}

function countListeners(ctx: Context): Record<string, number> {
	const counts: Record<string, number> = {};
	const hooks = ctx.root.events._hooks;
	for (const name of Reflect.ownKeys(hooks)) {
		if (typeof name !== 'string' || name.startsWith('internal/')) continue;
		const count = hooks[name].length;
		if (count > 0) counts[name] = count;
	}
	return counts;
}

function collectServiceState(snapshot: StateSnapshot, name: string, service: unknown): void {
	if (service instanceof Registry) {
		snapshot.registries[name] = service.listAll().map((entry) => entry.id);
		return;
	}
	if (typeof service !== 'object' || service === null) return;
	for (const [field, value] of Object.entries(service)) {
		if (value instanceof Registry) {
			snapshot.registries[`${name}.${field}`] = value.listAll().map((entry) => entry.id);
		}
	}
	if (isSnapshotable(service)) snapshot.services[name] = service.snapshotState();
}

export interface MountOptions {
	/** Plugins mounted onto the root context first, in order, before the snapshot is taken. */
	providers?: Plugin[];
	/** Config passed to the plugin under test. */
	config?: unknown;
	/** Fake `window.desktop` for renderer plugins. Installed for the lifetime of the mount. */
	desktop?: Partial<DesktopBridge> | true;
	/** Fake `ipcMain` for main plugins; its handlers are part of the snapshot. */
	ipcMain?: FakeIpcMain;
}

export interface MountedPlugin {
	ctx: Context;
	fiber: Fiber;
	/** State before the plugin was mounted (after the providers). */
	snapshot: StateSnapshot;
	desktop: FakeDesktop | undefined;
	/** Current state, for assertions in the middle of a test. */
	currentState: () => StateSnapshot;
	/** Dispose the plugin and assert that state equals `snapshot`. Always cleans up. */
	assertUnmountsClean: () => Promise<void>;
	/** Dispose providers and remove the spies. Safe to call more than once. */
	cleanup: () => Promise<void>;
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function mountPlugin(
	plugin: Plugin,
	options: MountOptions = {}
): Promise<MountedPlugin> {
	const ctx = new Context();
	const tracker = new EnvironmentTracker();
	tracker.install();
	let desktop: FakeDesktop | undefined;
	if (options.desktop === true) desktop = installFakeDesktop();
	else if (options.desktop) desktop = installFakeDesktop(options.desktop);
	const sources: SnapshotSources = { tracker, ipcMain: options.ipcMain };

	const providerFibers: Fiber[] = [];
	for (const provider of options.providers ?? []) {
		providerFibers.push(await ctx.plugin(provider));
	}
	await settle();
	const snapshot = snapshotState(ctx, sources);

	const fiber = await ctx.plugin(plugin, options.config);
	await settle();

	let cleanedUp = false;
	const cleanup = async (): Promise<void> => {
		if (cleanedUp) return;
		cleanedUp = true;
		for (const provider of providerFibers.reverse()) await provider.dispose();
		desktop?.restore();
		tracker.uninstall();
	};

	return {
		ctx,
		fiber,
		snapshot,
		desktop,
		currentState: () => snapshotState(ctx, sources),
		assertUnmountsClean: async () => {
			try {
				await fiber.dispose();
				await settle();
				expect(snapshotState(ctx, sources)).toEqual(snapshot);
			} finally {
				await cleanup();
			}
		},
		cleanup
	};
}

export interface PluginExpectations extends MountOptions {
	/** Assert that the plugin's contribution is present while it is mounted. */
	contributes(mounted: MountedPlugin): void | Promise<void>;
}

/** The standard test of a plugin: mount, assert contribution, unmount, state identical. */
export function describePlugin(
	name: string,
	plugin: Plugin,
	expectations: PluginExpectations
): void {
	describe(`plugin ${name}`, () => {
		it('declares inject and a matching name', () => {
			expect(plugin.name).toBe(name);
			expect(plugin.inject).toBeDefined();
		});

		it('mounts, contributes and unmounts leaving state identical', async () => {
			const mounted = await mountPlugin(plugin, expectations);
			try {
				await expectations.contributes(mounted);
			} catch (error) {
				await mounted.cleanup();
				throw error;
			}
			await mounted.assertUnmountsClean();
		});
	});
}
