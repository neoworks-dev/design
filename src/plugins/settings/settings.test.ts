import type { Plugin } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DesktopBridge, SettingsData } from '../../../electron/bridge';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import settings from './index';

interface Probe {
	plugin: Plugin;
	starts: number[];
}

/** A plugin with a `Config` schema that records the value it started with. */
function probe(name: string): Probe {
	const starts: number[] = [];
	const plugin = {
		name,
		inject: [],
		Config: z.object({ size: z.number().positive().max(10).default(1) }).prefault({}),
		apply(_ctx: unknown, config: { size: number }) {
			starts.push(config.size);
		}
	} as Plugin;
	return { plugin, starts };
}

function bridgeWith(stored: SettingsData): {
	bridge: Partial<DesktopBridge>;
	save: ReturnType<typeof vi.fn<(data: SettingsData) => Promise<void>>>;
} {
	const save = vi.fn((_data: SettingsData) => Promise.resolve());
	const bridge: Partial<DesktopBridge> = {
		settings: { load: () => Promise.resolve(stored), save }
	};
	return { bridge, save };
}

const infrastructure = [
	coreRegions,
	coreContextKeys,
	coreKeymap,
	coreCommands,
	coreMenus,
	desktopBridge
];

const emptyStore: SettingsData = { core: {}, plugins: {} };

describePlugin('settings', settings, {
	providers: infrastructure,
	desktop: bridgeWith(emptyStore).bridge,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('settings.open')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+,');
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'settings/dialog'
		);
		expect(ctx.settings.sections().map((section) => section.id)).toContain('core');
	}
});

describe('settings store applied through plugin Config and fiber.update', () => {
	it('gives a running plugin its stored config once the preferences are read', async () => {
		const sizes = probe('sizes');
		const { bridge } = bridgeWith({ core: {}, plugins: { sizes: { size: 5 } } });
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure, sizes.plugin],
			desktop: bridge
		});
		await vi.waitFor(() => expect(sizes.starts).toEqual([1, 5]));
		await mounted.cleanup();
	});

	it('restarts only the plugin whose setting changed, and persists the override', async () => {
		const first = probe('first');
		const second = probe('second');
		const { bridge, save } = bridgeWith(emptyStore);
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure, first.plugin, second.plugin],
			desktop: bridge
		});
		await vi.waitFor(() => expect(mounted.ctx.settings.loaded).toBe(true));

		expect(mounted.ctx.settings.set('first', 'size', 4)).toEqual({ ok: true });
		await vi.waitFor(() => expect(first.starts).toEqual([1, 4]));
		expect(second.starts).toEqual([1]);
		await mounted.ctx.settings.settled();
		expect(save).toHaveBeenLastCalledWith({ core: {}, plugins: { first: { size: 4 } } });
		await mounted.cleanup();
	});

	it('rejects an invalid value with the schema message and changes nothing', async () => {
		const sizes = probe('sizes');
		const { bridge, save } = bridgeWith(emptyStore);
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure, sizes.plugin],
			desktop: bridge
		});
		await vi.waitFor(() => expect(mounted.ctx.settings.loaded).toBe(true));

		const result = mounted.ctx.settings.set('sizes', 'size', 99);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected a rejection');
		expect(result.message).toContain('<=10');
		expect(mounted.ctx.settings.set('sizes', 'size', -1).ok).toBe(false);
		expect(mounted.ctx.settings.set('sizes', 'size', 'big').ok).toBe(false);
		await mounted.ctx.settings.settled();
		expect(sizes.starts).toEqual([1]);
		expect(save).not.toHaveBeenCalled();
		await mounted.cleanup();
	});

	it('persists a plugin updating its own config, and reset drops the override', async () => {
		const sizes = probe('sizes');
		const { bridge, save } = bridgeWith(emptyStore);
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure],
			desktop: bridge
		});
		await vi.waitFor(() => expect(mounted.ctx.settings.loaded).toBe(true));
		const fiber = mounted.ctx.plugin(sizes.plugin);
		await fiber;

		fiber.update({ size: 7 });
		await mounted.ctx.settings.settled();
		expect(save).toHaveBeenLastCalledWith({ core: {}, plugins: { sizes: { size: 7 } } });

		expect(mounted.ctx.settings.reset('sizes', 'size')).toEqual({ ok: true });
		await mounted.ctx.settings.settled();
		expect(save).toHaveBeenLastCalledWith({ core: {}, plugins: {} });
		await mounted.cleanup();
	});

	it('stores only values that differ from the default', async () => {
		const sizes = probe('sizes');
		const { bridge, save } = bridgeWith(emptyStore);
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure, sizes.plugin],
			desktop: bridge
		});
		await vi.waitFor(() => expect(mounted.ctx.settings.loaded).toBe(true));
		mounted.ctx.settings.set('sizes', 'size', 1);
		await mounted.ctx.settings.settled();
		expect(save).toHaveBeenLastCalledWith({ core: {}, plugins: {} });
		await mounted.cleanup();
	});

	it('generates a field per Config key, with the default and the bounds', async () => {
		const sizes = probe('sizes');
		const mounted = await mountPlugin(settings, {
			providers: [...infrastructure, sizes.plugin],
			desktop: bridgeWith(emptyStore).bridge
		});
		const section = mounted.ctx.settings.sections().find((candidate) => candidate.id === 'sizes');
		expect(section?.fields).toEqual([
			{ key: 'size', label: 'Size', kind: 'number', defaultValue: 1, min: 0, max: 10 }
		]);
		await mounted.cleanup();
	});

	it('applies the core theme to the document and restores it on unmount', async () => {
		const before = document.documentElement.dataset.theme;
		const mounted = await mountPlugin(settings, {
			providers: infrastructure,
			desktop: bridgeWith({ core: { theme: 'light' }, plugins: {} }).bridge
		});
		await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
		expect(mounted.ctx.settings.set('core', 'theme', 'purple').ok).toBe(false);
		expect(mounted.ctx.settings.set('core', 'theme', 'dark').ok).toBe(true);
		expect(document.documentElement.dataset.theme).toBe('dark');
		await mounted.assertUnmountsClean();
		expect(document.documentElement.dataset.theme).toBe(before);
	});
});
