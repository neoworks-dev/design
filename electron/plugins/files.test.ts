import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSetProps } from '../../src/lib/document/changes';
import type { DesignDocument } from '../../src/lib/document/types';
import type { CommitResult, IpcResult, LibraryFile, LoadedDocument, StoreInfo } from '../bridge';
import type { FakeWindow } from '../kernel/fakeHost';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';
import { TransactionRecorder } from '../store/testRecorder';
import { mainFilesPlugin } from './files';
import { mainLibraryPlugin } from './library';
import { mainStorePlugin } from './store';

let directory = '';
let userData = '';
let library = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-files-test-'));
	userData = path.join(directory, 'userData');
	library = path.join(directory, 'library');
	mkdirSync(userData);
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

type Kernel = TestKernel & { window: FakeWindow };

async function boot(launchPaths: string[] = []): Promise<Kernel> {
	return bootMinimalKernel(
		[
			{ plugin: mainLibraryPlugin, config: { libraryDirectory: library } },
			{ plugin: mainStorePlugin },
			{ plugin: mainFilesPlugin, config: { flushTimeoutMs: 10, launchPaths } }
		],
		{ paths: { userData, documents: path.join(directory, 'documents') } }
	);
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

function libraryFiles(): string[] {
	if (!existsSync(library)) return [];
	return readdirSync(library).filter((name) => name.endsWith('.ndesign'));
}

/** Edit the open document the way the renderer would: one persisted transaction. */
async function editOpenDocument(
	kernel: Kernel,
	document: DesignDocument
): Promise<TransactionRecorder> {
	const recorder = new TransactionRecorder(document);
	const [pageId] = Object.keys(document.nodes);
	const transaction = recorder.edit(
		'Rename page',
		planSetProps(recorder.store, pageId, { name: 'Edited' })
	);
	value(await call<CommitResult>(kernel, 'store:commit', { transactions: [transaction] }));
	return recorder;
}

function flushRequests(kernel: Kernel): number {
	return kernel.window.sent.filter((message) => message.channel === 'files:flush-request').length;
}

describe('main-files plugin', () => {
	it('mounts its routes and listeners and unmounts leaving the host identical', async () => {
		const kernel = await bootMinimalKernel(
			[
				{ plugin: mainLibraryPlugin, config: { libraryDirectory: library } },
				{ plugin: mainStorePlugin }
			],
			{ paths: { userData } }
		);
		const before = kernel.host.snapshot();
		const fiber = kernel.root.plugin(mainFilesPlugin, {});
		await fiber;
		await settle();
		const mounted = kernel.host.snapshot();
		expect(mounted.handlers).toEqual(
			expect.arrayContaining([
				'files:new',
				'files:open',
				'files:openDialog',
				'files:saveDialog',
				'files:saveAs',
				'files:launchRequest',
				'files:recent',
				'files:clearRecent',
				'files:setThumbnail',
				'files:flushed',
				'files:removeRecent',
				'files:reveal'
			])
		);
		expect(mounted.handlers).not.toContain('files:newUntitled');
		expect(mounted.appListeners).toMatchObject({ 'open-file': 1, 'second-instance': 1 });
		await fiber.dispose();
		await settle();
		expect(kernel.host.snapshot()).toEqual(before);
	});
});

describe('new document', () => {
	it('creates Untitled.ndesign in the library root and makes it the window document', async () => {
		const kernel = await boot();
		const { info, document } = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		expect(info).toMatchObject({ name: 'Untitled', inLibrary: true, recovered: false });
		expect(info.path).toBe(path.join(realLibrary(), 'Untitled.ndesign'));
		expect(Object.values(document.nodes).map((node) => node.name)).toEqual(['Page 1']);
		expect(kernel.root.store.openPaths()).toEqual([info.path]);
	});

	it('numbers further documents and puts them in a given folder', async () => {
		const kernel = await boot();
		const first = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const second = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		expect(path.basename(first.info.path)).toBe('Untitled.ndesign');
		expect(path.basename(second.info.path)).toBe('Untitled 2.ndesign');
		expect(second.info.name).toBe('Untitled 2');
		const folder = path.join(realLibrary(), 'Work');
		mkdirSync(folder);
		const inFolder = value(await call<LoadedDocument>(kernel, 'files:new', { directory: folder }));
		expect(inFolder.info.path).toBe(path.join(folder, 'Untitled.ndesign'));
		expect(kernel.root.store.openPaths()).toEqual([inFolder.info.path]);
	});

	it('never asks, flushes the previous document first and leaves it and its edits alone', async () => {
		const kernel = await boot();
		const first = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		await editOpenDocument(kernel, first.document);
		const before = flushRequests(kernel);
		value(await call<LoadedDocument>(kernel, 'files:new', {}));
		expect(flushRequests(kernel)).toBe(before + 1);
		expect(kernel.host.messageBoxRequests).toEqual([]);
		expect(libraryFiles()).toEqual(['Untitled 2.ndesign', 'Untitled.ndesign']);
		const back = value(await call<LoadedDocument>(kernel, 'files:open', { path: first.info.path }));
		expect(Object.values(back.document.nodes).some((node) => node.name === 'Edited')).toBe(true);
	});

	it('refuses a directory outside the library', async () => {
		const kernel = await boot();
		const outside = path.join(directory, 'elsewhere');
		mkdirSync(outside);
		expect(failureOf(await call(kernel, 'files:new', { directory: outside }))).toMatch(
			/^HANDLER_FAILED: .*neither in the library nor in a linked folder/
		);
		expect(libraryFiles()).toEqual([]);
	});
});

function realLibrary(): string {
	mkdirSync(library, { recursive: true });
	return path.resolve(library);
}

describe('open', () => {
	it('opens a design file and returns its document', async () => {
		const target = path.join(directory, 'a.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		const opened = value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		expect(opened.document).toEqual(richDocument());
		expect(opened.info).toMatchObject({ path: target, inLibrary: false });
	});

	it('a library file reports inLibrary', async () => {
		const target = path.join(realLibrary(), 'a.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		const opened = value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		expect(opened.info.inLibrary).toBe(true);
	});

	it('a file that cannot be opened is a readable error and the window keeps its document', async () => {
		const kernel = await boot();
		const current = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		expect(
			failureOf(await call(kernel, 'files:open', { path: path.join(directory, 'nope.ndesign') }))
		).toMatch(/^HANDLER_FAILED: .* does not exist$/);
		expect(kernel.root.store.openPaths()).toEqual([current.info.path]);
	});

	it('refuses paths that are not design files', async () => {
		const kernel = await boot();
		expect(failureOf(await call(kernel, 'files:open', { path: '/etc/passwd' }))).toMatch(
			/is not a \.ndesign file/
		);
	});
});

describe('save a copy as', () => {
	it('copies the document, continues in the copy and leaves the source alone', async () => {
		const kernel = await boot();
		const first = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const recorder = await editOpenDocument(kernel, first.document);
		const target = path.join(directory, 'Saved Design.ndesign');

		const info = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: target }));
		expect(info).toMatchObject({
			path: target,
			name: 'Saved Design',
			inLibrary: false,
			recovered: false
		});
		expect(kernel.root.store.openPaths()).toEqual([target]);
		expect(existsSync(first.info.path)).toBe(true);
		const reloaded = value(await call<LoadedDocument>(kernel, 'store:load'));
		expect(reloaded.document).toEqual({ ...recorder.document, name: 'Saved Design' });
	});

	it('appends the extension, replaces an existing file and keeps the source intact', async () => {
		const source = path.join(directory, 'source.ndesign');
		const original = richDocument();
		DocumentFile.create(source, original).close();
		const taken = path.join(directory, 'taken.ndesign');
		DocumentFile.create(taken, createOther()).close();
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: source }));

		const info = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: taken }));
		expect(info.path).toBe(taken);
		const copy = DocumentFile.open(taken, { session: false });
		expect(copy.load()).toEqual({ ...original, name: 'taken' });
		copy.close();

		const plain = path.join(directory, 'noextension');
		const second = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: plain }));
		expect(second.path).toBe(`${plain}.ndesign`);
		expect(existsSync(`${plain}.ndesign`)).toBe(true);

		const untouched = DocumentFile.open(source, { session: false });
		expect(untouched.load()).toEqual(original);
		untouched.close();
	});

	it('saving as the current path changes nothing', async () => {
		const target = path.join(directory, 'same.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		const info = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: target }));
		expect(info.path).toBe(target);
		expect(readdirSync(directory).filter((name) => name.endsWith('.saving'))).toEqual([]);
	});

	it('flushes first, so the copy holds what the renderer had queued', async () => {
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const before = flushRequests(kernel);
		value(
			await call<StoreInfo>(kernel, 'files:saveAs', { path: path.join(directory, 'c.ndesign') })
		);
		expect(flushRequests(kernel)).toBe(before + 1);
	});
});

function createOther(): DesignDocument {
	const other = richDocument();
	other.id = 'other';
	other.name = 'Other';
	return other;
}

describe('native dialogs', () => {
	it('the open dialog is filtered to design files and starts in the library', async () => {
		const kernel = await boot();
		kernel.host.openDialogResult = ['/x/a.ndesign'];
		expect(value(await call(kernel, 'files:openDialog'))).toBe('/x/a.ndesign');
		expect(kernel.host.lastOpenDialogRequest).toMatchObject({
			multiple: false,
			defaultPath: realLibrary(),
			filters: [{ name: 'Draftboard File', extensions: ['ndesign'] }]
		});
		kernel.host.openDialogResult = null;
		expect(value(await call(kernel, 'files:openDialog'))).toBeNull();
	});

	it('the save dialog starts in the library and forces the extension on the answer', async () => {
		const kernel = await boot();
		kernel.host.saveDialogResult = '/x/chosen';
		expect(value(await call(kernel, 'files:saveDialog', { suggestedName: 'Untitled' }))).toBe(
			'/x/chosen.ndesign'
		);
		expect(kernel.host.lastSaveDialogRequest).toMatchObject({
			defaultPath: path.join(realLibrary(), 'Untitled.ndesign')
		});
		kernel.host.saveDialogResult = null;
		expect(value(await call(kernel, 'files:saveDialog', { suggestedName: 'x' }))).toBeNull();
	});
});

describe('closing the window', () => {
	it('flushes and closes without asking, with or without edits', async () => {
		const kernel = await boot();
		const first = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		await editOpenDocument(kernel, first.document);
		const before = flushRequests(kernel);
		const closing = kernel.window.requestClose();
		await settle();
		expect(flushRequests(kernel)).toBe(before + 1);
		const requests = kernel.window.sent.filter((m) => m.channel === 'files:flush-request');
		const { requestId } = requests[requests.length - 1].payload as { requestId: string };
		value(await call<void>(kernel, 'files:flushed', { requestId }));
		expect(await closing).toBe(true);
		expect(kernel.host.messageBoxRequests).toEqual([]);
		expect(kernel.root.store.openPaths()).toEqual([]);
		expect(existsSync(first.info.path)).toBe(true);
	});

	it('a window without a document closes at once', async () => {
		const kernel = await boot();
		expect(await kernel.window.requestClose()).toBe(true);
	});
});

describe('flushing the renderer', () => {
	it('pushes a flush request and resolves when the renderer confirms', async () => {
		const kernel = await boot();
		const pending = kernel.root.files.requestFlush(kernel.window);
		const request = kernel.window.sent.find((message) => message.channel === 'files:flush-request');
		if (!request) throw new Error('no flush request was pushed');
		const { requestId } = request.payload as { requestId: string };
		value(await call<void>(kernel, 'files:flushed', { requestId }));
		await pending;
		expect(kernel.root.files.snapshotState()).toMatchObject({ pendingFlushes: 0 });
	});

	it('gives up after the timeout when the renderer never answers', async () => {
		const kernel = await boot();
		await kernel.root.files.requestFlush(kernel.window);
		expect(kernel.root.files.snapshotState()).toMatchObject({ pendingFlushes: 0 });
	});

	it('a quit flushes every window that has a document first, without prompting', async () => {
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const before = flushRequests(kernel);
		await kernel.root.parallel('app/before-quit');
		expect(flushRequests(kernel)).toBe(before + 1);
		expect(kernel.host.messageBoxRequests).toEqual([]);
	});

	it('refuses a malformed flush answer', async () => {
		const kernel = await boot();
		expect(failureOf(await call(kernel, 'files:flushed', { requestId: '' }))).toMatch(
			/^INVALID_PAYLOAD/
		);
	});
});

describe('opening on the OS request', () => {
	it('hands the launch file to the renderer once', async () => {
		const kernel = await boot(['/x/launch.ndesign', '/x/second.ndesign']);
		expect(value(await call(kernel, 'files:launchRequest'))).toBe('/x/launch.ndesign');
		expect(value(await call(kernel, 'files:launchRequest'))).toBe('/x/second.ndesign');
		expect(value(await call(kernel, 'files:launchRequest'))).toBeNull();
	});

	it('macOS open-file and a second launch push an open request to the window', async () => {
		const kernel = await boot();
		kernel.host.emitAppEvent('open-file', '/x/finder.ndesign');
		kernel.host.emitAppEvent('second-instance', ['electron', '--flag', '/x/second.ndesign']);
		kernel.host.emitAppEvent('second-instance', ['electron']);
		const requests = kernel.window.sent
			.filter((message) => message.channel === 'files:open-request')
			.map((message) => message.payload);
		expect(requests).toEqual([{ path: '/x/finder.ndesign' }, { path: '/x/second.ndesign' }]);
	});
});

describe('recent files', () => {
	function makeDesign(name: string, where: string = directory): string {
		const target = path.join(where, name);
		DocumentFile.create(target, richDocument()).close();
		return target;
	}

	async function recentPaths(kernel: Kernel): Promise<string[]> {
		return value(await call<LibraryFile[]>(kernel, 'files:recent')).map((entry) => entry.path);
	}

	it('lists opened files newest first and reopening moves a file to the front', async () => {
		const first = makeDesign('a.ndesign');
		const second = makeDesign('b.ndesign');
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: first }));
		value(await call<LoadedDocument>(kernel, 'files:open', { path: second }));
		expect(await recentPaths(kernel)).toEqual([second, first]);
		value(await call<LoadedDocument>(kernel, 'files:open', { path: first }));
		expect(await recentPaths(kernel)).toEqual([first, second]);
		expect(kernel.host.osRecentDocuments).toEqual([first, second, first]);
	});

	it('records library files and new documents too, with their location', async () => {
		const kernel = await boot();
		const created = value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const external = makeDesign('ext.ndesign');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: external }));
		const folder = path.join(realLibrary(), 'Work');
		mkdirSync(folder);
		const inFolder = makeDesign('f.ndesign', folder);
		value(await call<LoadedDocument>(kernel, 'files:open', { path: inFolder }));
		const recent = value(await call<LibraryFile[]>(kernel, 'files:recent'));
		expect(recent.map((entry) => [entry.path, entry.location])).toEqual([
			[inFolder, { kind: 'library', folder: 'Work' }],
			[external, { kind: 'external' }],
			[created.info.path, { kind: 'library', folder: '' }]
		]);
		expect(recent[0].openedAt).toBeTypeOf('number');
	});

	it('records Save a copy as destinations', async () => {
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:new', {}));
		const target = path.join(directory, 'saved.ndesign');
		value(await call(kernel, 'files:saveAs', { path: target }));
		expect((await recentPaths(kernel))[0]).toBe(target);
	});

	it('prunes files that vanished when the list is read', async () => {
		const kept = makeDesign('kept.ndesign');
		const gone = makeDesign('gone.ndesign');
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: gone }));
		value(await call<LoadedDocument>(kernel, 'files:open', { path: kept }));
		rmSync(gone);
		expect(await recentPaths(kernel)).toEqual([kept]);
		const reboot = await boot();
		expect(await recentPaths(reboot)).toEqual([kept]);
	});

	it('caps the list at 20 entries', async () => {
		const kernel = await boot();
		for (let index = 0; index < 22; index += 1) {
			const target = makeDesign(`f${index}.ndesign`);
			value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		}
		const paths = await recentPaths(kernel);
		expect(paths).toHaveLength(20);
		expect(paths[0]).toBe(path.join(directory, 'f21.ndesign'));
	});

	it('clearRecent empties the list and the OS list', async () => {
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: makeDesign('a.ndesign') }));
		value(await call(kernel, 'files:clearRecent'));
		expect(await recentPaths(kernel)).toEqual([]);
		expect(kernel.host.osRecentDocuments).toEqual([]);
	});

	it('returns the stored thumbnail of each file, null until one was written', async () => {
		const target = makeDesign('a.ndesign');
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		expect(value(await call<LibraryFile[]>(kernel, 'files:recent'))[0].thumbnail).toBeNull();
		const thumbnail = { mime: 'image/png', width: 2, height: 3, bytes: new Uint8Array([1, 2, 3]) };
		value(await call(kernel, 'files:setThumbnail', thumbnail));
		const [entry] = value(await call<LibraryFile[]>(kernel, 'files:recent'));
		expect(entry.thumbnail).toEqual(thumbnail);
	});

	it('removeRecent forgets one file and keeps the file on disk', async () => {
		const first = makeDesign('a.ndesign');
		const second = makeDesign('b.ndesign');
		const kernel = await boot();
		value(await call<LoadedDocument>(kernel, 'files:open', { path: first }));
		value(await call<LoadedDocument>(kernel, 'files:open', { path: second }));
		value(await call(kernel, 'files:removeRecent', { path: first }));
		expect(await recentPaths(kernel)).toEqual([second]);
		expect(existsSync(first)).toBe(true);
	});

	it('reveal and removeRecent refuse files the app does not know', async () => {
		const kernel = await boot();
		const stranger = makeDesign('stranger.ndesign');
		expect(failureOf(await call(kernel, 'files:reveal', { path: stranger }))).toMatch(
			/neither in the library/
		);
		expect(failureOf(await call(kernel, 'files:removeRecent', { path: stranger }))).toMatch(
			/neither in the library/
		);
		expect(kernel.host.revealed).toEqual([]);
	});

	it('reveal shows a recent or library file in the OS file manager', async () => {
		const kernel = await boot();
		const target = makeDesign('a.ndesign');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: target }));
		value(await call(kernel, 'files:reveal', { path: target }));
		const inLibrary = makeDesign('lib.ndesign', realLibrary());
		value(await call(kernel, 'files:reveal', { path: inLibrary }));
		expect(kernel.host.revealed).toEqual([target, inLibrary]);
	});
});
