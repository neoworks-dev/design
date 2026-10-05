import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IpcResult, PluginList } from '../bridge';
import { bootTestKernel, type TestKernel } from '../kernel/testing';
import { installName } from './pluginDiscovery';
import { readZip, stripCommonRoot, ZipError } from './zipExtract';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-plugin-install-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

const manifest = JSON.stringify({ id: 'tidy', name: 'Tidy', version: '1.0.0' });

function userRoot(): string {
	return path.join(directory, 'plugins');
}

async function boot(): Promise<TestKernel> {
	return bootTestKernel({ host: { paths: { userData: directory } } });
}

async function call(
	kernel: TestKernel,
	channel: string,
	payload?: unknown
): Promise<IpcResult<PluginList>> {
	return (await kernel.host.invoke(channel, payload)) as IpcResult<PluginList>;
}

function userNames(result: IpcResult<PluginList>): string[] {
	if (!result.ok) throw new Error(result.error.message);
	return result.value.plugins
		.filter((plugin) => plugin.source === 'user')
		.map((plugin) => plugin.directoryName);
}

describe('installing plugins', () => {
	it('copies a plugin folder into the user plugins directory', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile('/downloads/tidy/manifest.json', manifest);
		kernel.host.setPluginFile('/downloads/tidy/main.js', 'design.log.info("hi")');
		const result = await call(kernel, 'plugins:install', { path: '/downloads/tidy' });
		expect(userNames(result)).toEqual(['tidy']);
		expect(kernel.host.pluginTree.get(`${userRoot()}/tidy/main.js`)).toBe('design.log.info("hi")');
	});

	it('unpacks a .zip under the archive name', async () => {
		const kernel = await boot();
		kernel.host.pluginArchives.set('/downloads/tidy-1.0.zip', {
			'manifest.json': manifest,
			'main.js': ''
		});
		const result = await call(kernel, 'plugins:install', { path: '/downloads/tidy-1.0.zip' });
		expect(userNames(result)).toEqual(['tidy-1.0']);
	});

	it('refuses a folder without a manifest and leaves nothing behind', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile('/downloads/nothing/readme.txt', 'no plugin here');
		const result = await call(kernel, 'plugins:install', { path: '/downloads/nothing' });
		expect(result.ok).toBe(false);
		expect([...kernel.host.pluginTree.keys()].some((file) => file.startsWith(userRoot()))).toBe(
			false
		);
	});

	it('does not overwrite an installed plugin', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile(`${userRoot()}/tidy/manifest.json`, manifest);
		kernel.host.setPluginFile('/downloads/tidy/manifest.json', manifest);
		const result = await call(kernel, 'plugins:install', { path: '/downloads/tidy' });
		expect(result).toMatchObject({ ok: false });
		expect(kernel.host.pluginTree.get(`${userRoot()}/tidy/manifest.json`)).toBe(manifest);
	});

	it('removes an installed plugin and nothing outside the user directory', async () => {
		const kernel = await boot();
		kernel.host.setPluginFile(`${userRoot()}/tidy/manifest.json`, manifest);
		kernel.host.setPluginFile(`${directory}/precious/manifest.json`, manifest);
		const outside = await call(kernel, 'plugins:remove', { directoryName: '../precious' });
		expect(outside.ok).toBe(false);
		expect(kernel.host.pluginTree.has(`${directory}/precious/manifest.json`)).toBe(true);
		const removed = await call(kernel, 'plugins:remove', { directoryName: 'tidy' });
		expect(userNames(removed)).toEqual([]);
	});

	it('names the folder after the source, made safe', () => {
		expect(installName('/x/My Plugin.zip')).toBe('My-Plugin');
		expect(installName('/x/.hidden')).toBe('hidden');
	});
});

interface Part {
	name: string;
	text: string;
	deflate?: boolean;
}

/** A minimal zip: local headers, central directory, end record. */
function buildZip(parts: Part[]): Uint8Array {
	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const part of parts) {
		const raw = Buffer.from(part.text);
		const data = part.deflate === true ? deflateRawSync(raw) : raw;
		const method = part.deflate === true ? 8 : 0;
		const name = Buffer.from(part.name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		chunks.push(local, name, data);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(method, 10);
		entry.writeUInt32LE(data.length, 20);
		entry.writeUInt32LE(raw.length, 24);
		entry.writeUInt16LE(name.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, name);
		offset += local.length + name.length + data.length;
	}
	const directorySize = central.reduce((total, chunk) => total + chunk.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(parts.length, 10);
	end.writeUInt32LE(directorySize, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...chunks, ...central, end]));
}

describe('zip extraction', () => {
	it('reads stored and deflated entries', () => {
		const entries = readZip(
			buildZip([
				{ name: 'tidy/manifest.json', text: manifest },
				{ name: 'tidy/main.js', text: 'x'.repeat(500), deflate: true }
			])
		);
		expect(entries.map((entry) => entry.path)).toEqual(['tidy/manifest.json', 'tidy/main.js']);
		expect(new TextDecoder().decode(entries[1].bytes)).toBe('x'.repeat(500));
		expect(stripCommonRoot(entries).map((entry) => entry.path)).toEqual([
			'manifest.json',
			'main.js'
		]);
	});

	it('keeps a flat archive as it is', () => {
		const entries = readZip(buildZip([{ name: 'manifest.json', text: manifest }]));
		expect(stripCommonRoot(entries).map((entry) => entry.path)).toEqual(['manifest.json']);
	});

	it('refuses paths that climb out and files that are not zips', () => {
		expect(() => readZip(buildZip([{ name: '../evil.js', text: '' }]))).toThrow(ZipError);
		expect(() => readZip(buildZip([{ name: '/etc/passwd', text: '' }]))).toThrow(/unsafe path/);
		expect(() => readZip(new Uint8Array(100))).toThrow(/not a zip/);
	});
});
