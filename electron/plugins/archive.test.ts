import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArchiveEntry, IpcResult } from '../bridge';
import { readZip, writeZip } from '../archive/zip';
import { bootTestKernel, settle } from '../kernel/testing';
import { hashBytes } from '../store/assetStore';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';

async function temporaryDirectory(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), 'design-archive-'));
}

const entries: ArchiveEntry[] = [
	{ path: 'manifest.json', bytes: new TextEncoder().encode('{"a":1}') },
	{ path: 'assets/x.png', bytes: new Uint8Array([1, 2, 3]) }
];

describe('main-archive', () => {
	it('registers its routes and removes them on unload', async () => {
		const { host, root } = await bootTestKernel();
		for (const channel of ['archive:export', 'archive:read', 'archive:create']) {
			expect(host.snapshot().handlers).toContain(channel);
		}
		await root.fiber.dispose();
		await settle();
		expect(host.handlers.has('archive:export')).toBe(false);
	});

	it('export writes a zip where the save dialog says, adding the extension', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		host.saveDialogResult = path.join(directory, 'design');
		const answer = await host.invoke('archive:export', { suggestedName: 'Design', entries });
		expect(answer).toEqual({ ok: true, value: path.join(directory, 'design.zip') });
		const read = readZip(await readFile(path.join(directory, 'design.zip')));
		expect(read.map((entry) => entry.path)).toEqual(['assets/x.png', 'manifest.json']);
		expect(host.lastSaveDialogRequest?.filters?.[0].extensions).toEqual(['zip']);
	});

	it('export cancelled writes nothing', async () => {
		const { host } = await bootTestKernel();
		host.saveDialogResult = null;
		expect(await host.invoke('archive:export', { suggestedName: 'x', entries })).toEqual({
			ok: true,
			value: null
		});
	});

	it('export refuses an entry that would escape the archive root', async () => {
		const { host } = await bootTestKernel();
		const answer = await host.invoke('archive:export', {
			suggestedName: 'x',
			entries: [{ path: '../evil', bytes: new Uint8Array([1]) }]
		});
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});

	it('read answers the chosen zip as entries', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		const file = path.join(directory, 'in.zip');
		await writeFile(file, writeZip(entries));
		host.openDialogResult = [file];
		const answer = (await host.invoke('archive:read')) as IpcResult<{
			path: string;
			entries: ArchiveEntry[];
		} | null>;
		expect(answer.ok && answer.value?.path).toBe(file);
		expect(answer.ok && answer.value?.entries.map((entry) => entry.path)).toEqual([
			'assets/x.png',
			'manifest.json'
		]);
	});

	it('read explains a file that is not a zip and returns null when cancelled', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		const file = path.join(directory, 'bad.zip');
		await writeFile(file, 'definitely not a zip file, but long enough to be read');
		host.openDialogResult = [file];
		const answer = await host.invoke('archive:read');
		expect(answer).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining('Cannot read') }
		});
		host.openDialogResult = null;
		expect(await host.invoke('archive:read')).toEqual({ ok: true, value: null });
	});

	it('create writes a design file with the document, images and fonts', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		const target = path.join(directory, 'imported');
		host.saveDialogResult = target;
		const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		const hash = hashBytes(bytes);
		const document = richDocument();
		document.assets = { [hash]: { id: hash, mime: 'image/png', width: 2, height: 2 } };
		const answer = await host.invoke('archive:create', {
			document,
			images: [{ hash, mime: 'image/png', width: 2, height: 2, bytes }],
			fonts: [{ family: 'Brand Sans', style: 'Bold', bytes: new Uint8Array([9, 9]) }]
		});
		expect(answer).toEqual({ ok: true, value: `${target}.ndesign` });

		const file = DocumentFile.open(`${target}.ndesign`);
		try {
			expect(file.load()).toEqual(document);
			expect([...(file.readAssetBytes(hash) ?? [])]).toEqual([...bytes]);
			expect(file.embeddedFonts()).toEqual([{ family: 'Brand Sans', style: 'Bold' }]);
		} finally {
			file.close();
		}
	});

	it('create refuses an image that does not match its hash and leaves no complete file', async () => {
		const { host } = await bootTestKernel();
		const directory = await temporaryDirectory();
		host.saveDialogResult = path.join(directory, 'bad');
		const document = richDocument();
		const answer = await host.invoke('archive:create', {
			document,
			images: [{ hash: 'ab'.repeat(32), mime: 'image/png', bytes: new Uint8Array([1]) }],
			fonts: []
		});
		expect(answer).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining('checksum') }
		});
		expect(existsSync(path.join(directory, 'bad.ndesign'))).toBe(false);
	});

	it('create rejects an invalid document through the payload schema', async () => {
		const { host } = await bootTestKernel();
		const answer = await host.invoke('archive:create', {
			document: { nodes: 'nope' },
			images: [],
			fonts: []
		});
		expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
	});
});
