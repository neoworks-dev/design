import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommitResult, IpcResult, LoadedDocument, StoreInfo } from '../bridge';
import { planSetProps } from '../../src/lib/document/changes';
import { TransactionRecorder } from '../store/testRecorder';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import type { FakeWindow } from '../kernel/fakeHost';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';
import { mainStorePlugin } from './store';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-store-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

type Kernel = TestKernel & { window: FakeWindow };

async function boot(): Promise<Kernel> {
	return bootMinimalKernel([{ plugin: mainStorePlugin }]);
}

async function call<T>(kernel: Kernel, channel: string, payload?: unknown): Promise<IpcResult<T>> {
	return (await kernel.host.invoke(channel, payload)) as IpcResult<T>;
}

function value<T>(result: IpcResult<T>): T {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
}

function failureOf<T>(result: IpcResult<T>): string {
	if (result.ok) return 'ok';
	return `${result.error.code}: ${result.error.message}`;
}

describe('main-store plugin', () => {
	it('mounts its routes and unmounts leaving the host state identical', async () => {
		const kernel = await bootMinimalKernel([]);
		const before = kernel.host.snapshot();
		const fiber = kernel.root.plugin(mainStorePlugin);
		await fiber;
		await settle();
		const mounted = kernel.host.snapshot();
		expect(mounted.handlers).toEqual(
			expect.arrayContaining(['store:open', 'store:create', 'store:load', 'store:close'])
		);
		await fiber.dispose();
		await settle();
		expect(kernel.host.snapshot()).toEqual(before);
	});

	it('creates a file, loads the document back, and closes', async () => {
		const kernel = await boot();
		const target = path.join(directory, 'a.ndesign');
		const document = richDocument();
		const info = value(await call<StoreInfo>(kernel, 'store:create', { path: target, document }));
		expect(info).toMatchObject({ path: target, name: 'Rich fixture', documentId: 'doc-rich' });

		const loaded = value(await call<LoadedDocument>(kernel, 'store:load'));
		expect(loaded.document).toEqual(document);
		expect(loaded.info).toEqual(info);

		value(await call<void>(kernel, 'store:close'));
		expect(failureOf(await call(kernel, 'store:load'))).toMatch(/no document file open/);
	});

	it('creates a blank document when none is sent', async () => {
		const kernel = await boot();
		const target = path.join(directory, 'blank.ndesign');
		value(await call<StoreInfo>(kernel, 'store:create', { path: target }));
		const loaded = value(await call<LoadedDocument>(kernel, 'store:load'));
		expect(Object.values(loaded.document.nodes).map((node) => node.name)).toEqual(['Page 1']);
	});

	it('opens an existing file written earlier', async () => {
		const target = path.join(directory, 'earlier.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		value(await call<StoreInfo>(kernel, 'store:open', { path: target }));
		expect(value(await call<LoadedDocument>(kernel, 'store:load')).document).toEqual(
			richDocument()
		);
	});

	it('replies with readable errors: missing, not ours, newer version, corrupt', async () => {
		const kernel = await boot();
		expect(
			failureOf(await call(kernel, 'store:open', { path: path.join(directory, 'nope') }))
		).toMatch(/^HANDLER_FAILED: .* does not exist$/);

		const text = path.join(directory, 'text.ndesign');
		writeFileSync(text, 'plain text, not a database '.repeat(10));
		expect(failureOf(await call(kernel, 'store:open', { path: text }))).toMatch(
			/not a design file/
		);

		const newer = path.join(directory, 'newer.ndesign');
		DocumentFile.create(newer, richDocument()).close();
		const database = new DatabaseSync(newer);
		database.exec('PRAGMA journal_mode = DELETE; PRAGMA user_version = 99');
		database.close();
		expect(failureOf(await call(kernel, 'store:open', { path: newer }))).toMatch(
			/newer version of the app/
		);

		const corrupt = path.join(directory, 'corrupt.ndesign');
		DocumentFile.create(corrupt, richDocument()).close();
		const tamper = new DatabaseSync(corrupt);
		tamper.exec("PRAGMA journal_mode = DELETE; UPDATE nodes SET data = '{' WHERE type = 'TEXT'");
		tamper.close();
		value(await call<StoreInfo>(kernel, 'store:open', { path: corrupt }));
		expect(failureOf(await call(kernel, 'store:load'))).toMatch(
			/HANDLER_FAILED: .*unreadable data/
		);
	});

	it('rejects an invalid payload before any file is touched', async () => {
		const kernel = await boot();
		expect(failureOf(await call(kernel, 'store:open', { path: '' }))).toMatch(/^INVALID_PAYLOAD/);
		expect(
			failureOf(await call(kernel, 'store:create', { path: 'x', document: { nodes: 1 } }))
		).toMatch(/^INVALID_PAYLOAD/);
	});

	it('a failed open keeps the document the window already had', async () => {
		const kernel = await boot();
		const good = path.join(directory, 'good.ndesign');
		value(await call<StoreInfo>(kernel, 'store:create', { path: good }));
		expect(
			failureOf(await call(kernel, 'store:open', { path: path.join(directory, 'nope') }))
		).not.toBe('ok');
		expect(value(await call<LoadedDocument>(kernel, 'store:load')).info.path).toBe(good);
	});

	it('opening another file closes the first; closing the window closes the file', async () => {
		const kernel = await boot();
		const first = path.join(directory, 'first.ndesign');
		const second = path.join(directory, 'second.ndesign');
		value(await call<StoreInfo>(kernel, 'store:create', { path: first }));
		const firstFile = kernel.root.store.current(kernel.window.sender);
		value(await call<StoreInfo>(kernel, 'store:create', { path: second }));
		await settle();
		expect(firstFile.isOpen).toBe(false);
		expect(kernel.root.store.openPaths()).toEqual([second]);

		const secondFile = kernel.root.store.current(kernel.window.sender);
		kernel.window.close();
		await settle();
		expect(secondFile.isOpen).toBe(false);
		expect(kernel.root.store.openPaths()).toEqual([]);
	});

	it('unloading the plugin closes every open file', async () => {
		const kernel = await boot();
		value(
			await call<StoreInfo>(kernel, 'store:create', { path: path.join(directory, 'x.ndesign') })
		);
		const file = kernel.root.store.current(kernel.window.sender);
		await kernel.root.fiber.dispose();
		await settle();
		expect(file.isOpen).toBe(false);
	});

	it('persists committed transactions in order and a reopened file shows them', async () => {
		const kernel = await boot();
		const target = path.join(directory, 'edit.ndesign');
		const document = richDocument();
		value(await call<StoreInfo>(kernel, 'store:create', { path: target, document }));
		const recorder = new TransactionRecorder(document);
		const [heroId] = Object.values(document.nodes)
			.filter((node) => node.name === 'Hero')
			.map((node) => node.id);
		const first = recorder.edit('Rename', planSetProps(recorder.store, heroId, { name: 'Banner' }));
		const second = recorder.edit('Resize', planSetProps(recorder.store, heroId, { width: 640 }));

		const result = value(
			await call<CommitResult>(kernel, 'store:commit', { transactions: [first, second] })
		);
		expect(result).toEqual({ committed: 2, documentRows: 2 });
		// a retry of the same message (lost reply) changes nothing
		expect(
			value(await call<CommitResult>(kernel, 'store:commit', { transactions: [first, second] }))
		).toEqual({ committed: 0, documentRows: 0 });
		expect(value(await call<LoadedDocument>(kernel, 'store:load')).document).toEqual(
			recorder.document
		);

		await kernel.root.store.close(kernel.window.sender);
		await settle();
		const reopened = DocumentFile.open(target);
		expect(reopened.load()).toEqual(recorder.document);
		reopened.close();
	});

	it('refuses a malformed transaction before touching the file, and commits need an open file', async () => {
		const kernel = await boot();
		expect(failureOf(await call(kernel, 'store:commit', { transactions: [] }))).toMatch(
			/no document file open/
		);
		value(
			await call<StoreInfo>(kernel, 'store:create', { path: path.join(directory, 'm.ndesign') })
		);
		const bad = { id: 't', origin: 'user', label: 'x', changes: [{ t: 'nope' }], undo: [] };
		expect(failureOf(await call(kernel, 'store:commit', { transactions: [bad] }))).toMatch(
			/^INVALID_PAYLOAD/
		);
		const missingNode = {
			id: 't2',
			origin: 'user',
			label: 'x',
			changes: [{ t: 'set', id: 'ghost', set: { name: 'x' }, prev: {} }],
			undo: []
		};
		expect(failureOf(await call(kernel, 'store:commit', { transactions: [missingNode] }))).toMatch(
			/^HANDLER_FAILED: .*missing node ghost/
		);
	});

	it('checkpoint saves: clears the unsaved marker; a crashed file reopens as recovered', async () => {
		const kernel = await boot();
		const target = path.join(directory, 'save.ndesign');
		const document = richDocument();
		value(await call<StoreInfo>(kernel, 'store:create', { path: target, document }));
		const recorder = new TransactionRecorder(document);
		const [heroId] = Object.values(document.nodes)
			.filter((node) => node.name === 'Hero')
			.map((node) => node.id);
		value(
			await call<CommitResult>(kernel, 'store:commit', {
				transactions: [recorder.edit('Rename', planSetProps(recorder.store, heroId, { name: 'A' }))]
			})
		);
		expect(kernel.root.store.current(kernel.window.sender).info().unsaved).toBe(true);
		const saved = value(await call<StoreInfo>(kernel, 'store:checkpoint'));
		expect(saved.unsaved).toBe(false);

		const crashed = path.join(directory, 'crashed.ndesign');
		copyFileSync(target, crashed);
		for (const suffix of ['-wal', '-shm']) {
			if (existsSync(`${target}${suffix}`))
				copyFileSync(`${target}${suffix}`, `${crashed}${suffix}`);
		}
		const reopened = DocumentFile.open(crashed);
		expect(reopened.info().recovered).toBe(true);
		reopened.close();
	});

	it('a golden file copied from the fixtures opens through IPC', async () => {
		const target = path.join(directory, 'golden.ndesign');
		copyFileSync(path.join(import.meta.dirname, '../store/fixtures/v1.ndesign'), target);
		const kernel = await boot();
		value(await call<StoreInfo>(kernel, 'store:open', { path: target }));
		expect(value(await call<LoadedDocument>(kernel, 'store:load')).document.name).toBe(
			'Rich fixture'
		);
	});
});
