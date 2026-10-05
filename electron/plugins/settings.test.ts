import { describe, expect, it } from 'vitest';
import { bootTestKernel, settle } from '../kernel/testing';
import { SETTINGS_FILE, parseSettings } from './settings';

describe('main-settings', () => {
	it('registers the settings routes and removes them on unload', async () => {
		const { host, root } = await bootTestKernel();
		expect(host.snapshot().handlers).toEqual(
			expect.arrayContaining(['settings:load', 'settings:save'])
		);
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('settings:load')).toBe(false);
		expect(host.handlers.has('settings:save')).toBe(false);
	});

	it('loads empty preferences when nothing was saved', async () => {
		const { host } = await bootTestKernel();
		expect(await host.invoke('settings:load')).toEqual({
			ok: true,
			value: { core: {}, plugins: {} }
		});
	});

	it('saves to the user data file and loads the same values back', async () => {
		const { host } = await bootTestKernel();
		const data = { core: { theme: 'light' }, plugins: { nudge: { step: 2 } } };
		expect(await host.invoke('settings:save', data)).toEqual({ ok: true, value: undefined });
		expect(host.userData.readText(SETTINGS_FILE)).toContain('"step": 2');
		expect(await host.invoke('settings:load')).toEqual({ ok: true, value: data });
	});

	it('rejects a payload of the wrong shape', async () => {
		const { host } = await bootTestKernel();
		const answer = await host.invoke('settings:save', { core: 1, plugins: {} });
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});

	it('reads a corrupt or misshapen file as no preferences', () => {
		expect(parseSettings('{not json')).toEqual({ core: {}, plugins: {} });
		expect(parseSettings('[]')).toEqual({ core: {}, plugins: {} });
		expect(parseSettings(undefined)).toEqual({ core: {}, plugins: {} });
	});
});
