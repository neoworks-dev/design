import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planEntityAdd, planSetProps } from '../../src/lib/document/changes';
import type { Paint } from '../../src/lib/document/types';
import type { AssetPutResult, CommitResult, IpcResult } from '../bridge';
import type { FakeWindow } from '../kernel/fakeHost';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import { hashBytes } from '../store/assetStore';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';
import { TransactionRecorder } from '../store/testRecorder';
import { mainAssetsPlugin } from './assets';
import { mainLibraryPlugin } from './library';
import { mainStorePlugin } from './store';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-assets-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

type Kernel = TestKernel & { window: FakeWindow };

async function boot(): Promise<Kernel> {
	const kernel = await bootMinimalKernel([
		{ plugin: mainLibraryPlugin, config: { libraryDirectory: path.join(directory, 'library') } },
		{ plugin: mainStorePlugin },
		{ plugin: mainAssetsPlugin }
	]);
	value(await call(kernel, 'store:create', { path: path.join(directory, 'a.ndesign') }));
	return kernel;
}

async function call<T>(kernel: Kernel, channel: string, payload?: unknown): Promise<IpcResult<T>> {
	return (await kernel.host.invoke(channel, payload)) as IpcResult<T>;
}

function value<T>(result: IpcResult<T>): T {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
}

const IMAGE = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const OTHER_IMAGE = new Uint8Array([137, 80, 78, 71, 9, 9, 9]);

async function put(
	kernel: Kernel,
	bytes: Uint8Array,
	width = 4,
	height = 3
): Promise<AssetPutResult> {
	return value(
		await call<AssetPutResult>(kernel, 'assets:put', { mime: 'image/png', bytes, width, height })
	);
}

describe('main-assets plugin', () => {
	it('mounts its routes and unmounts leaving the host state identical', async () => {
		const kernel = await bootMinimalKernel([
			{ plugin: mainLibraryPlugin, config: { libraryDirectory: path.join(directory, 'library') } },
			{ plugin: mainStorePlugin }
		]);
		const before = kernel.host.snapshot();
		const fiber = kernel.root.plugin(mainAssetsPlugin);
		await fiber;
		await settle();
		expect(kernel.host.snapshot().handlers).toEqual(
			expect.arrayContaining(['assets:put', 'assets:get', 'assets:collect', 'assets:embedFont'])
		);
		await fiber.dispose();
		await settle();
		expect(kernel.host.snapshot()).toEqual(before);
	});
});

describe('image blobs', () => {
	it('stores the same image twice as one row, keyed by its sha-256', async () => {
		const kernel = await boot();
		const first = await put(kernel, IMAGE);
		const second = await put(kernel, new Uint8Array(IMAGE));
		expect(first.record).toEqual({ id: hashBytes(IMAGE), mime: 'image/png', width: 4, height: 3 });
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		const file = kernel.root.store.current(kernel.window.sender);
		const rows = file.requireOpen().prepare('SELECT count(*) AS count FROM assets').get();
		expect(rows).toEqual({ count: 1 });
	});

	it('returns the bytes by hash, and null for an unknown hash', async () => {
		const kernel = await boot();
		const { record } = await put(kernel, IMAGE);
		const bytes = value(await call<Uint8Array>(kernel, 'assets:get', { hash: record.id }));
		expect(Array.from(bytes)).toEqual(Array.from(IMAGE));
		expect(value(await call(kernel, 'assets:get', { hash: '0'.repeat(64) }))).toBeNull();
	});

	it('rejects a malformed hash before touching the file', async () => {
		const kernel = await boot();
		const result = await call(kernel, 'assets:get', { hash: '../etc/passwd' });
		expect(result.ok).toBe(false);
	});

	it('removes unreferenced blobs at checkpoint and keeps the ones a paint uses', async () => {
		const kernel = await boot();
		const used = await put(kernel, IMAGE);
		const unused = await put(kernel, OTHER_IMAGE);
		const document = richDocument();
		value(await call(kernel, 'store:close'));
		value(
			await call(kernel, 'store:create', { path: path.join(directory, 'b.ndesign'), document })
		);
		const usedAgain = await put(kernel, IMAGE);
		const unusedAgain = await put(kernel, OTHER_IMAGE);
		expect(usedAgain.record.id).toBe(used.record.id);
		expect(unusedAgain.record.id).toBe(unused.record.id);

		const recorder = new TransactionRecorder(document);
		const rectangle = Object.values(document.nodes).find((node) => node.type === 'RECTANGLE');
		if (rectangle === undefined) throw new Error('fixture has no rectangle');
		const paint: Paint = {
			type: 'IMAGE',
			imageHash: used.record.id,
			scaleMode: 'FILL',
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL'
		};
		const transaction = recorder.edit(
			'Image fill',
			planSetProps(recorder.store, rectangle.id, { fills: [paint] })
		);
		value(await call<CommitResult>(kernel, 'store:commit', { transactions: [transaction] }));

		expect(
			Array.from(value(await call<Uint8Array>(kernel, 'assets:get', { hash: unused.record.id })))
		).toEqual(Array.from(OTHER_IMAGE));
		value(await call(kernel, 'store:checkpoint'));
		expect(value(await call(kernel, 'assets:get', { hash: unused.record.id }))).toBeNull();
		expect(value(await call(kernel, 'assets:get', { hash: used.record.id }))).not.toBeNull();
	});

	it('collect removes unreferenced blobs on demand and reports their hashes', async () => {
		const kernel = await boot();
		const { record } = await put(kernel, IMAGE);
		expect(value(await call<string[]>(kernel, 'assets:collect'))).toEqual([record.id]);
		expect(value(await call<string[]>(kernel, 'assets:collect'))).toEqual([]);
	});

	it('keeps the stored bytes when the renderer later commits the record', async () => {
		const kernel = await boot();
		const { record } = await put(kernel, IMAGE);
		const document = richDocument();
		const recorder = new TransactionRecorder(document);
		const transaction = recorder.edit('Add asset', planEntityAdd('asset', record));
		value(await call<CommitResult>(kernel, 'store:commit', { transactions: [transaction] }));
		expect(value(await call(kernel, 'assets:get', { hash: record.id }))).not.toBeNull();
	});
});

describe('embedded fonts', () => {
	it('stores a font file in the fonts table and lists and returns it', async () => {
		const kernel = await boot();
		const bytes = new Uint8Array([0, 1, 0, 0, 7]);
		value(await call(kernel, 'assets:embedFont', { family: 'Inter', style: 'Bold', bytes }));
		value(await call(kernel, 'assets:embedFont', { family: 'Inter', style: 'Bold', bytes }));
		expect(value(await call(kernel, 'assets:embeddedFonts'))).toEqual([
			{ family: 'Inter', style: 'Bold' }
		]);
		const stored = value(
			await call<Uint8Array>(kernel, 'assets:fontBytes', { family: 'Inter', style: 'Bold' })
		);
		expect(Array.from(stored)).toEqual(Array.from(bytes));
		expect(
			value(await call(kernel, 'assets:fontBytes', { family: 'Inter', style: 'Thin' }))
		).toBeNull();
	});

	it('survives close and reopen, and appears in the loaded document as embedded', async () => {
		const kernel = await boot();
		const target = path.join(directory, 'a.ndesign');
		value(
			await call(kernel, 'assets:embedFont', {
				family: 'Inter',
				style: 'Bold',
				bytes: new Uint8Array([5])
			})
		);
		value(await call(kernel, 'store:close'));
		const file = DocumentFile.open(target);
		expect(file.embeddedFonts()).toEqual([{ family: 'Inter', style: 'Bold' }]);
		expect(file.load().fonts).toEqual([{ family: 'Inter', style: 'Bold', source: 'embedded' }]);
		file.close();
	});
});
