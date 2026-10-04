import { Context, Service } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { Registry, type RegistryEntry } from '../registries/registry.svelte';
import { describePlugin, FakeIpcMain, mountPlugin } from './testing';

declare module '@neoworks/extension-system' {
	interface Context {
		widgets: WidgetService;
	}
	interface Events {
		'testing/ping'(): void;
	}
}

class WidgetService extends Service {
	readonly registry = new Registry<RegistryEntry>();

	constructor(ctx: Context) {
		super(ctx, 'widgets');
	}

	register(entry: RegistryEntry): () => void {
		return this.registry.register(entry);
	}
}

const widgets = {
	name: 'widgets-provider',
	inject: [],
	apply(ctx: Context): void {
		new WidgetService(ctx);
	}
};

const cleanPlugin = {
	name: 'clean',
	inject: ['widgets'],
	apply(ctx: Context): void {
		ctx.effect(() => ctx.widgets.register({ id: 'clean/widget' }), 'clean widget');
		ctx.effect(() => {
			const listener = (): void => undefined;
			window.addEventListener('resize', listener);
			return () => window.removeEventListener('resize', listener);
		}, 'clean resize listener');
		ctx.effect(() => {
			const interval = setInterval(() => undefined, 1000);
			return () => clearInterval(interval);
		}, 'clean interval');
		ctx.on('testing/ping', () => undefined);
	}
};

describePlugin('clean', cleanPlugin, {
	providers: [widgets],
	contributes: ({ ctx, currentState }) => {
		expect(ctx.widgets.registry.has('clean/widget')).toBe(true);
		expect(currentState().domListeners).toEqual({ 'window:resize': 1 });
		expect(currentState().timers).toBe(1);
		expect(currentState().listeners).toEqual({ 'testing/ping': 1 });
	}
});

async function expectLeak(plugin: object, providers = [widgets]): Promise<void> {
	const mounted = await mountPlugin(plugin as never, { providers });
	await expect(mounted.assertUnmountsClean()).rejects.toThrow();
}

describe('state-identical check detects leaks', () => {
	it('a registry entry registered without ctx.effect', async () => {
		await expectLeak({
			name: 'leaks-registry',
			inject: ['widgets'],
			apply(ctx: Context): void {
				ctx.widgets.register({ id: 'leaked' });
			}
		});
	});

	it('a window listener without an inverse', async () => {
		await expectLeak({
			name: 'leaks-listener',
			inject: [],
			apply(): void {
				window.addEventListener('keydown', () => undefined);
			}
		});
	});

	it('an interval that is never cleared', async () => {
		await expectLeak({
			name: 'leaks-interval',
			inject: [],
			apply(): void {
				setInterval(() => undefined, 1000);
			}
		});
	});

	it('a kernel listener attached through a different plugin ctx (outer ctx mistake)', async () => {
		let rootContext: Context | undefined;
		const capture = {
			name: 'capture',
			inject: [],
			apply: (ctx: Context) => void (rootContext = ctx)
		};
		const mounted = await mountPlugin(
			{
				name: 'leaks-outer-ctx',
				inject: [],
				apply(): void {
					rootContext?.on('testing/ping', () => undefined);
				}
			},
			{ providers: [capture] }
		);
		await expect(mounted.assertUnmountsClean()).rejects.toThrow();
	});

	it('an ipc handler without removeHandler', async () => {
		const ipcMain = new FakeIpcMain();
		const mounted = await mountPlugin(
			{
				name: 'leaks-ipc',
				inject: [],
				apply(): void {
					ipcMain.handle('leak:channel', () => undefined);
				}
			},
			{ ipcMain }
		);
		await expect(mounted.assertUnmountsClean()).rejects.toThrow();
	});
});

describe('main plugins', () => {
	it('unmounts clean when ipc handlers are registered as effects', async () => {
		const ipcMain = new FakeIpcMain();
		const mounted = await mountPlugin(
			{
				name: 'main-clean',
				inject: [],
				apply(ctx: Context): void {
					ctx.effect(() => {
						ipcMain.handle('clean:channel', () => 'pong');
						return () => ipcMain.removeHandler('clean:channel');
					}, 'ipc clean:channel');
				}
			},
			{ ipcMain }
		);
		expect(await ipcMain.invoke('clean:channel')).toBe('pong');
		await mounted.assertUnmountsClean();
	});
});
