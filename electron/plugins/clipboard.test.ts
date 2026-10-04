import { describe, expect, it } from 'vitest';
import { bootTestKernel, settle } from '../kernel/testing';

describe('main-clipboard', () => {
	it('registers clipboard:read and clipboard:write and removes them on unload', async () => {
		const { host, root } = await bootTestKernel();
		expect(host.snapshot().handlers).toEqual(
			expect.arrayContaining(['clipboard:read', 'clipboard:write'])
		);
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('clipboard:read')).toBe(false);
		expect(host.handlers.has('clipboard:write')).toBe(false);
	});

	it('writes text, html and png together and reads them back', async () => {
		const { host } = await bootTestKernel();
		const png = new Uint8Array([137, 80, 78, 71]);
		expect(await host.invoke('clipboard:write', { text: 'hi', html: '<b>hi</b>', png })).toEqual({
			ok: true,
			value: undefined
		});
		expect(await host.invoke('clipboard:read')).toEqual({
			ok: true,
			value: { text: 'hi', html: '<b>hi</b>', png }
		});
	});

	it('a write replaces the previous content and an empty clipboard reads as nulls', async () => {
		const { host } = await bootTestKernel();
		expect(await host.invoke('clipboard:read')).toEqual({
			ok: true,
			value: { text: null, html: null, png: null }
		});
		await host.invoke('clipboard:write', { html: '<i>x</i>' });
		await host.invoke('clipboard:write', { text: 'only text' });
		expect(await host.invoke('clipboard:read')).toEqual({
			ok: true,
			value: { text: 'only text', html: null, png: null }
		});
	});

	it('rejects a payload with unknown keys', async () => {
		const { host } = await bootTestKernel();
		const answer = await host.invoke('clipboard:write', { evil: true });
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});
});
