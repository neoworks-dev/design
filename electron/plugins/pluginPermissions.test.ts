import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IpcResult } from '../bridge';
import { bootTestKernel, type TestKernel } from '../kernel/testing';
import { parseDecisionsFile, PERMISSIONS_FILE } from './pluginPermissions';
import { storageFileName } from './pluginStorage';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-plugin-permissions-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

const manifest = (overrides: Record<string, unknown> = {}): string =>
	JSON.stringify({
		id: 'weather',
		name: 'Weather',
		version: '1.0.0',
		permissions: ['network'],
		networkAccess: { allowedDomains: ['api.weather.test', '*.cdn.test'] },
		...overrides
	});

async function boot(source: 'user' | 'builtin' = 'user'): Promise<TestKernel> {
	const kernel = await bootTestKernel({ host: { paths: { userData: directory } } });
	const root = source === 'user' ? path.join(directory, 'plugins') : '/fake/bundled-plugins';
	kernel.host.setPluginFile(`${root}/weather/manifest.json`, manifest());
	return kernel;
}

async function call<Result>(
	kernel: TestKernel,
	channel: string,
	payload?: unknown
): Promise<IpcResult<Result>> {
	return (await kernel.host.invoke(channel, payload)) as IpcResult<Result>;
}

function fetchRequest(url: string): unknown {
	return { pluginId: 'weather', url };
}

describe('main-plugin-permissions', () => {
	it('stores grants and denials per plugin and lets the user forget one', async () => {
		const kernel = await boot();
		const granted = await call(kernel, 'plugins:setPermission', {
			pluginId: 'weather',
			permission: 'network',
			granted: true
		});
		expect(granted).toEqual({ ok: true, value: { weather: { network: true } } });
		expect(parseDecisionsFile(kernel.host.files.get(PERMISSIONS_FILE))).toHaveProperty(
			'user:weather',
			{ network: true }
		);
		expect(await call(kernel, 'plugins:permissions')).toEqual({
			ok: true,
			value: { weather: { network: true } }
		});
		const forgotten = await call(kernel, 'plugins:setPermission', {
			pluginId: 'weather',
			permission: 'network',
			granted: null
		});
		expect(forgotten).toEqual({ ok: true, value: {} });
	});

	it('refuses a request while network is not granted', async () => {
		const kernel = await boot();
		const result = await call(kernel, 'plugins:fetch', fetchRequest('https://api.weather.test/x'));
		expect(result.ok).toBe(false);
		expect(kernel.host.fetched).toEqual([]);
	});

	it('blocks a host outside the allowlist and lets listed hosts through', async () => {
		const kernel = await boot();
		await call(kernel, 'plugins:setPermission', {
			pluginId: 'weather',
			permission: 'network',
			granted: true
		});
		const blocked = await call(kernel, 'plugins:fetch', fetchRequest('https://evil.test/x'));
		expect(blocked).toMatchObject({ ok: false });
		if (blocked.ok) throw new Error('expected a refusal');
		expect(blocked.error.message).toContain('evil.test is not in');
		expect(kernel.host.fetched).toEqual([]);

		const allowed = await call(kernel, 'plugins:fetch', fetchRequest('https://a.cdn.test/x'));
		expect(allowed).toMatchObject({ ok: true, value: { status: 200, body: 'ok' } });
		expect(kernel.host.fetched).toEqual(['https://a.cdn.test/x']);
	});

	it('bundled plugins hold the permissions they declare without a decision', async () => {
		const kernel = await boot('builtin');
		const allowed = await call(kernel, 'plugins:fetch', fetchRequest('https://api.weather.test/x'));
		expect(allowed.ok).toBe(true);
	});

	it('refuses a permission the manifest does not declare even when granted', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile(
			`${path.join(directory, 'plugins')}/weather/manifest.json`,
			manifest({ permissions: [] })
		);
		await call(kernel, 'plugins:setPermission', {
			pluginId: 'weather',
			permission: 'network',
			granted: true
		});
		const result = await call(kernel, 'plugins:fetch', fetchRequest('https://api.weather.test/x'));
		expect(result.ok).toBe(false);
	});
});

describe('main-plugin-storage', () => {
	it('keeps values per plugin in a file of their own and survives a reload', async () => {
		const kernel = await boot();
		const set = (pluginId: string, key: string, value: unknown): Promise<IpcResult<unknown>> =>
			call(kernel, 'plugins:storageSet', { pluginId, key, value });
		await set('weather', 'city', { name: 'Oslo' });
		await set('weather', '__proto__', 1);
		await set('other', 'city', 'Rome');
		expect(await call(kernel, 'plugins:storageGet', { pluginId: 'weather', key: 'city' })).toEqual({
			ok: true,
			value: { name: 'Oslo' }
		});
		expect(await call(kernel, 'plugins:storageGet', { pluginId: 'other', key: 'city' })).toEqual({
			ok: true,
			value: 'Rome'
		});
		expect(kernel.host.files.has(storageFileName('weather'))).toBe(true);
		const keys = await call<string[]>(kernel, 'plugins:storageKeys', { pluginId: 'weather' });
		expect(keys).toEqual({ ok: true, value: ['city', '__proto__'] });

		const reloaded = await bootTestKernel({ host: { paths: { userData: directory } } });
		for (const [name, text] of kernel.host.files) reloaded.host.files.set(name, text);
		expect(
			await call(reloaded, 'plugins:storageGet', { pluginId: 'weather', key: 'city' })
		).toEqual({ ok: true, value: { name: 'Oslo' } });

		await call(kernel, 'plugins:storageDelete', { pluginId: 'weather', key: 'city' });
		expect(await call(kernel, 'plugins:storageGet', { pluginId: 'weather', key: 'city' })).toEqual({
			ok: true,
			value: null
		});
	});

	it('refuses a plugin that would keep more than 5 MB', async () => {
		const kernel = await boot();
		const result = await call(kernel, 'plugins:storageSet', {
			pluginId: 'weather',
			key: 'big',
			value: 'x'.repeat(5 * 1024 * 1024 + 1)
		});
		expect(result.ok).toBe(false);
	});
});
