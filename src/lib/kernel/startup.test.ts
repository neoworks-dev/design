import { Context, type Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { bootKernel } from './boot.svelte';
import {
	DISABLED_PLUGINS_KEY,
	namesToDisable,
	readDisabledPlugins,
	readStartupOptions,
	writeDisabledPlugins
} from './startup';

function memoryStorage(initial: Record<string, string> = {}): {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
} {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value)
	};
}

function plugin(name: string, applied: string[]): Plugin {
	return { name, inject: [], apply: () => void applied.push(name) } as Plugin;
}

describe('startup options', () => {
	it('reads safe mode and the failing-plugin switch from the query', () => {
		expect(readStartupOptions('?safe=1', undefined)).toMatchObject({ safeMode: true });
		expect(readStartupOptions('?failplugin=1', undefined)).toMatchObject({
			failingPlugins: true,
			safeMode: false
		});
		expect(readStartupOptions('', undefined)).toMatchObject({
			failingPlugins: false,
			safeMode: false
		});
	});

	it('stores disabled plugins sorted and ignores garbage', () => {
		const storage = memoryStorage();
		writeDisabledPlugins(storage, new Set(['b', 'a']));
		expect(storage.getItem(DISABLED_PLUGINS_KEY)).toBe('["a","b"]');
		expect([...readDisabledPlugins(storage)]).toEqual(['a', 'b']);
		expect(readDisabledPlugins(memoryStorage({ [DISABLED_PLUGINS_KEY]: '{not json' })).size).toBe(
			0
		);
		expect(readDisabledPlugins(memoryStorage({ [DISABLED_PLUGINS_KEY]: '{"a":1}' })).size).toBe(0);
	});

	it('safe mode disables the optional plugins, normal mode only the user choices', () => {
		const plugins = [plugin('core', []), plugin('ai', []), plugin('extra', [])];
		const optional = new Set(['ai']);
		const user = new Set(['extra']);
		expect(
			namesToDisable(plugins, optional, { safeMode: false, disabled: user, failingPlugins: false })
		).toEqual(new Set(['extra']));
		expect(
			namesToDisable(plugins, optional, { safeMode: true, disabled: user, failingPlugins: false })
		).toEqual(new Set(['extra', 'ai']));
	});
});

describe('boot with disabled plugins', () => {
	it('does not mount them and lists them as disabled, not failed', async () => {
		const applied: string[] = [];
		const report = await bootKernel(
			new Context(),
			[plugin('core', applied), plugin('ai', applied)],
			{ disabled: new Set(['ai']) }
		);
		expect(applied).toEqual(['core']);
		expect(report.records).toContainEqual({ name: 'ai', status: 'disabled' });
		expect(report.failures).toEqual([]);
		expect(report.disabled.map((record) => record.name)).toEqual(['ai']);
	});

	it('disablePlugin unloads a running plugin and reverts its effects', async () => {
		const ctx = new Context();
		const reverted: string[] = [];
		const mounted = {
			name: 'mounted',
			inject: [],
			apply(own: Context): void {
				own.effect(() => () => void reverted.push('mounted'), 'test effect');
			}
		} as Plugin;
		const report = await bootKernel(ctx, [mounted]);
		expect(report.records[0].status).toBe('active');
		await report.disablePlugin('mounted');
		expect(reverted).toEqual(['mounted']);
		expect(report.records[0].status).toBe('disabled');
		await expect(report.retryPlugin('mounted')).rejects.toThrow('disabled');
	});
});
