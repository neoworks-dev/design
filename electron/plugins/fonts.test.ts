import { describe, expect, it } from 'vitest';
import { simpleFont } from '../fonts/testFont';
import { bootTestKernel, settle } from '../kernel/testing';

const FONTS = {
	'/fonts/inter-regular.ttf': {
		family: 'Inter',
		style: 'Regular',
		bytes: new Uint8Array([1, 2, 3])
	},
	'/fonts/inter-bold.ttf': { family: 'Inter', style: 'Bold', bytes: new Uint8Array([4, 5]) },
	'/fonts/lora.otf': { family: 'Lora', style: 'Italic', bytes: simpleFont('Lora', 'Italic') }
};

describe('main-fonts', () => {
	it('registers fonts:list and fonts:load and removes them on unload', async () => {
		const { host, root } = await bootTestKernel({ host: { fonts: FONTS } });
		expect(host.snapshot().handlers).toEqual(expect.arrayContaining(['fonts:list', 'fonts:load']));
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('fonts:list')).toBe(false);
		expect(host.handlers.has('fonts:load')).toBe(false);
	});

	it('lists installed faces without leaking file paths, scanning only once', async () => {
		const { host } = await bootTestKernel({ host: { fonts: FONTS } });
		const first = await host.invoke('fonts:list');
		const second = await host.invoke('fonts:list');
		expect(first).toEqual({
			ok: true,
			value: [
				{ family: 'Inter', style: 'Regular' },
				{ family: 'Inter', style: 'Bold' },
				{ family: 'Lora', style: 'Italic' }
			]
		});
		expect(second).toEqual(first);
		expect(host.scanCount).toBe(1);
	});

	it('loads bytes by family and style, case-insensitively, and caches them', async () => {
		const { host } = await bootTestKernel({ host: { fonts: FONTS } });
		const loaded = await host.invoke('fonts:load', { family: 'inter', style: 'BOLD' });
		expect(loaded).toEqual({ ok: true, value: new Uint8Array([4, 5]) });
		await host.invoke('fonts:load', { family: 'Inter', style: 'Bold' });
		await Promise.all([
			host.invoke('fonts:load', { family: 'Inter', style: 'Regular' }),
			host.invoke('fonts:load', { family: 'Inter', style: 'Regular' })
		]);
		expect(host.readCount).toBe(2);
	});

	it('answers null for a face that is not installed', async () => {
		const { host } = await bootTestKernel({ host: { fonts: FONTS } });
		expect(await host.invoke('fonts:load', { family: 'Nope', style: 'Regular' })).toEqual({
			ok: true,
			value: null
		});
	});

	it('rejects malformed payloads and reports read failures without crashing', async () => {
		const { host } = await bootTestKernel({ host: { fonts: FONTS } });
		expect(await host.invoke('fonts:load', { family: '' })).toMatchObject({
			ok: false,
			error: { code: 'INVALID_PAYLOAD' }
		});
		await host.invoke('fonts:list');
		host.installedFonts.delete('/fonts/lora.otf');
		const stale = await host.invoke('fonts:load', { family: 'Lora', style: 'Italic' });
		expect(stale).toMatchObject({ ok: false, error: { code: 'HANDLER_FAILED' } });
		host.installedFonts.set('/fonts/lora.otf', FONTS['/fonts/lora.otf']);
		expect(await host.invoke('fonts:load', { family: 'Lora', style: 'Italic' })).toMatchObject({
			ok: true
		});
	});
});
