import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootTestKernel, settle } from '../kernel/testing';

async function temporaryDirectory(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), 'design-exports-'));
}

describe('main-exports', () => {
	it('registers exports:write and removes it on unload', async () => {
		const { host, root } = await bootTestKernel();
		expect(host.snapshot().handlers).toContain('exports:write');
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('exports:write')).toBe(false);
	});

	it('one file goes where the save dialog says', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		host.saveDialogResult = path.join(directory, 'chosen.png');
		const bytes = new Uint8Array([137, 80, 78, 71]);
		const answer = await host.invoke('exports:write', { files: [{ name: 'Card.png', bytes }] });
		expect(answer).toEqual({ ok: true, value: [path.join(directory, 'chosen.png')] });
		expect(new Uint8Array(await readFile(path.join(directory, 'chosen.png')))).toEqual(bytes);
	});

	it('several files go into the picked folder under their names', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		host.openDialogResult = [directory];
		await host.invoke('exports:write', {
			files: [
				{ name: 'A.png', bytes: new Uint8Array([1]) },
				{ name: 'A@2x.png', bytes: new Uint8Array([2]) }
			]
		});
		expect(host.lastOpenDialogRequest).toMatchObject({ directory: true });
		expect((await readdir(directory)).sort()).toEqual(['A.png', 'A@2x.png']);
	});

	it('strips directories from names so nothing escapes the folder', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		host.openDialogResult = [directory];
		await host.invoke('exports:write', {
			files: [
				{ name: '../../evil.png', bytes: new Uint8Array([1]) },
				{ name: 'ok.png', bytes: new Uint8Array([2]) }
			]
		});
		expect((await readdir(directory)).sort()).toEqual(['evil.png', 'ok.png']);
	});

	it('cancelling the dialog writes nothing', async () => {
		const { host } = await bootTestKernel();
		host.saveDialogResult = null;
		const answer = await host.invoke('exports:write', {
			files: [{ name: 'A.png', bytes: new Uint8Array([1]) }]
		});
		expect(answer).toEqual({ ok: true, value: null });
	});

	it('rejects an empty file list', async () => {
		const { host } = await bootTestKernel();
		const answer = await host.invoke('exports:write', { files: [] });
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});
});
