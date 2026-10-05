import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	DirectoryListing,
	IpcResult,
	LibraryFile,
	LibraryFolder,
	LibraryOverview,
	LinkedFolder,
	LoadedDocument
} from '../bridge';
import type { FakeWindow } from '../kernel/fakeHost';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';
import { TransactionRecorder } from '../store/testRecorder';
import { planSetProps } from '../../src/lib/document/changes';
import { mainFilesPlugin } from './files';
import { mainLibraryPlugin } from './library';
import { mainLibraryOperationsPlugin } from './libraryOperations';
import { mainStorePlugin } from './store';

let directory = '';
let userData = '';
let root = '';
beforeEach(() => {
	directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'main-library-test-')));
	userData = path.join(directory, 'userData');
	root = path.join(directory, 'library');
	mkdirSync(userData);
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

type Kernel = TestKernel & { window: FakeWindow };

async function boot(): Promise<Kernel> {
	return bootMinimalKernel(
		[
			{ plugin: mainLibraryPlugin, config: { libraryDirectory: root } },
			{ plugin: mainStorePlugin },
			{ plugin: mainFilesPlugin, config: { flushTimeoutMs: 10 } },
			{ plugin: mainLibraryOperationsPlugin }
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

function makeDesign(where: string, name: string): string {
	mkdirSync(where, { recursive: true });
	const target = path.join(where, `${name}.ndesign`);
	DocumentFile.create(target, richDocument()).close();
	return target;
}

function movedMessages(kernel: Kernel): unknown[] {
	return kernel.window.sent
		.filter((message) => message.channel === 'files:moved')
		.map((message) => message.payload);
}

async function overview(kernel: Kernel): Promise<LibraryOverview> {
	return value(await call<LibraryOverview>(kernel, 'library:overview'));
}

describe('library plugins', () => {
	it('mount their routes and unmount leaving the host identical', async () => {
		const kernel = await bootMinimalKernel([], { paths: { userData } });
		const before = kernel.host.snapshot();
		const fibers = [
			kernel.root.plugin(mainLibraryPlugin, { libraryDirectory: root }),
			kernel.root.plugin(mainStorePlugin),
			kernel.root.plugin(mainFilesPlugin, {}),
			kernel.root.plugin(mainLibraryOperationsPlugin)
		];
		for (const fiber of fibers) await fiber;
		await settle();
		expect(kernel.host.snapshot().handlers).toEqual(
			expect.arrayContaining([
				'library:overview',
				'library:list',
				'library:search',
				'library:createFolder',
				'library:renameFolder',
				'library:trashFolder',
				'library:renameFile',
				'library:moveFile',
				'library:duplicateFile',
				'library:trashFile',
				'library:linkFolder',
				'library:unlinkFolder'
			])
		);
		for (const fiber of [...fibers].reverse()) await fiber.dispose();
		await settle();
		expect(kernel.host.snapshot()).toEqual(before);
	});

	it('does not create the library until something needs it', async () => {
		await boot();
		expect(existsSync(root)).toBe(false);
	});
});

describe('overview and listing', () => {
	it('creates the root on first use and lists folders with their file counts', async () => {
		const kernel = await boot();
		expect(await overview(kernel)).toEqual({ root, folders: [], linked: [] });
		expect(existsSync(root)).toBe(true);
		makeDesign(path.join(root, 'Work'), 'a');
		makeDesign(path.join(root, 'Work'), 'b');
		mkdirSync(path.join(root, '.hidden'));
		const { folders } = await overview(kernel);
		expect(folders).toMatchObject([{ name: 'Work', path: path.join(root, 'Work'), fileCount: 2 }]);
	});

	it('lists the files and folders of a directory with location, times and thumbnails', async () => {
		const kernel = await boot();
		const draft = makeDesign(root, 'Draft');
		const inWork = makeDesign(path.join(root, 'Work'), 'Logo');
		const listing = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: root })
		);
		expect(listing.directory).toBe(root);
		expect(listing.folders.map((folder) => folder.name)).toEqual(['Work']);
		expect(listing.files).toMatchObject([
			{
				path: draft,
				name: 'Draft',
				openedAt: null,
				thumbnail: null,
				location: { kind: 'library', folder: '' }
			}
		]);
		expect(listing.files[0].modifiedAt).toBeGreaterThan(0);
		const work = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: path.join(root, 'Work') })
		);
		expect(work.folders).toEqual([]);
		expect(work.files).toMatchObject([
			{ path: inWork, location: { kind: 'library', folder: 'Work' } }
		]);
	});

	it('reports openedAt for files that were opened', async () => {
		const kernel = await boot();
		const draft = makeDesign(root, 'Draft');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: draft }));
		const listing = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: root })
		);
		expect(listing.files[0].openedAt).toBeTypeOf('number');
	});

	it('searches names case-insensitively across the library and linked folders', async () => {
		const kernel = await boot();
		const hero = makeDesign(path.join(root, 'Work'), 'Hero Banner');
		const linkedDirectory = path.join(directory, 'repo');
		const heroLinked = makeDesign(linkedDirectory, 'hero mobile');
		makeDesign(root, 'Other');
		kernel.host.openDialogResult = [linkedDirectory];
		value(await call(kernel, 'library:linkFolder'));
		const found = value(await call<LibraryFile[]>(kernel, 'library:search', { query: 'HERO' }));
		expect(found.map((file) => file.path).sort()).toEqual([hero, heroLinked].sort());
		expect(value(await call<LibraryFile[]>(kernel, 'library:search', { query: '  ' }))).toEqual([]);
	});

	it('sorts search results by modification time, newest first', async () => {
		const kernel = await boot();
		const older = makeDesign(root, 'logo old');
		const newer = makeDesign(root, 'logo new');
		utimesSync(older, new Date(2020, 1, 1), new Date(2020, 1, 1));
		const found = value(await call<LibraryFile[]>(kernel, 'library:search', { query: 'logo' }));
		expect(found.map((file) => file.path)).toEqual([newer, older]);
	});
});

describe('path policy', () => {
	it('rejects directories outside the library, relative escapes and nested library folders', async () => {
		const kernel = await boot();
		await overview(kernel);
		const outside = path.join(directory, 'outside');
		mkdirSync(outside);
		const nested = path.join(root, 'Work', 'Deep');
		mkdirSync(nested, { recursive: true });
		for (const candidate of [
			outside,
			path.join(root, '..', 'outside'),
			path.join(root, 'Work', '..', '..', 'outside'),
			nested,
			'/etc'
		]) {
			expect(failureOf(await call(kernel, 'library:list', { directory: candidate }))).toMatch(
				/^HANDLER_FAILED: .*(neither in the library|not an available)/
			);
		}
	});

	it('rejects a symlink that leads out of the library', async () => {
		const kernel = await boot();
		await overview(kernel);
		const outside = path.join(directory, 'outside');
		makeDesign(outside, 'secret');
		symlinkSync(outside, path.join(root, 'Escape'));
		expect(
			failureOf(await call(kernel, 'library:list', { directory: path.join(root, 'Escape') }))
		).toMatch(/neither in the library/);
		expect(
			failureOf(
				await call(kernel, 'library:moveFile', {
					path: makeDesign(root, 'Mine'),
					directory: path.join(root, 'Escape')
				})
			)
		).toMatch(/neither in the library/);
		expect(readdirSync(outside)).toEqual(['secret.ndesign']);
		expect((await overview(kernel)).folders).toEqual([]);
	});

	it('rejects a symlinked design file and files outside the library', async () => {
		const kernel = await boot();
		await overview(kernel);
		const secret = makeDesign(path.join(directory, 'outside'), 'secret');
		symlinkSync(secret, path.join(root, 'Link.ndesign'));
		expect(
			failureOf(await call(kernel, 'library:trashFile', { path: path.join(root, 'Link.ndesign') }))
		).toMatch(/not a regular design file/);
		expect(failureOf(await call(kernel, 'library:trashFile', { path: secret }))).toMatch(
			/neither in the library/
		);
		expect(
			failureOf(await call(kernel, 'library:renameFile', { path: secret, name: 'x' }))
		).toMatch(/neither in the library/);
		expect(existsSync(secret)).toBe(true);
		expect(kernel.host.trashed).toEqual([]);
	});

	it('requires the design file extension', async () => {
		const kernel = await boot();
		await overview(kernel);
		writeFileSync(path.join(root, 'notes.txt'), 'x');
		expect(
			failureOf(await call(kernel, 'library:trashFile', { path: path.join(root, 'notes.txt') }))
		).toMatch(/not a \.ndesign file/);
	});

	it('rejects invalid names at the payload and in the service', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'a');
		for (const name of ['', '   ', 'a/b', '..', 'x'.repeat(201)]) {
			expect(failureOf(await call(kernel, 'library:renameFile', { path: file, name }))).toMatch(
				/^INVALID_PAYLOAD/
			);
			expect(failureOf(await call(kernel, 'library:createFolder', { parent: root, name }))).toMatch(
				/^INVALID_PAYLOAD/
			);
		}
		expect(() => kernel.root.library.renamedFilePath(file, '../x')).toThrow(/path separators/);
	});
});

describe('folders', () => {
	it('creates folders in the root, numbering taken names', async () => {
		const kernel = await boot();
		const first = value(
			await call<LibraryFolder>(kernel, 'library:createFolder', { parent: root, name: 'Work' })
		);
		const second = value(
			await call<LibraryFolder>(kernel, 'library:createFolder', { parent: root, name: 'Work' })
		);
		expect(first).toMatchObject({ name: 'Work', path: path.join(root, 'Work'), fileCount: 0 });
		expect(second.name).toBe('Work 2');
		expect(existsSync(path.join(root, 'Work 2'))).toBe(true);
	});

	it('does not nest library folders', async () => {
		const kernel = await boot();
		const work = value(
			await call<LibraryFolder>(kernel, 'library:createFolder', { parent: root, name: 'Work' })
		);
		expect(
			failureOf(await call(kernel, 'library:createFolder', { parent: work.path, name: 'Deep' }))
		).toMatch(/one level deep/);
	});

	it('renames a folder, refusing a taken name, the root and linked roots', async () => {
		const kernel = await boot();
		makeDesign(path.join(root, 'Work'), 'a');
		mkdirSync(path.join(root, 'Play'));
		const renamed = value(
			await call<LibraryFolder>(kernel, 'library:renameFolder', {
				path: path.join(root, 'Work'),
				name: 'Client'
			})
		);
		expect(renamed).toMatchObject({ name: 'Client', fileCount: 1 });
		expect(existsSync(path.join(root, 'Work'))).toBe(false);
		expect(
			failureOf(await call(kernel, 'library:renameFolder', { path: renamed.path, name: 'Play' }))
		).toMatch(/already exists/);
		expect(
			failureOf(await call(kernel, 'library:renameFolder', { path: root, name: 'Else' }))
		).toMatch(/Only folders/);
	});

	it('renaming a folder follows the open document and the recent list with files:moved', async () => {
		const kernel = await boot();
		const open = makeDesign(path.join(root, 'Work'), 'open');
		const other = makeDesign(path.join(root, 'Work'), 'other');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: other }));
		value(await call<LoadedDocument>(kernel, 'files:open', { path: open }));
		value(
			await call<LibraryFolder>(kernel, 'library:renameFolder', {
				path: path.join(root, 'Work'),
				name: 'Client'
			})
		);
		const movedOpen = path.join(root, 'Client', 'open.ndesign');
		const movedOther = path.join(root, 'Client', 'other.ndesign');
		expect(kernel.root.store.openPaths()).toEqual([movedOpen]);
		expect(movedMessages(kernel)).toEqual(
			expect.arrayContaining([
				{ from: open, to: movedOpen },
				{ from: other, to: movedOther }
			])
		);
		expect(movedMessages(kernel)).toHaveLength(2);
		const recent = value(await call<LibraryFile[]>(kernel, 'files:recent'));
		expect(recent.map((entry) => entry.path)).toEqual([movedOpen, movedOther]);
		expect(recent[0].location).toEqual({ kind: 'library', folder: 'Client' });
	});

	it('trashes a folder, closing documents inside and pushing files:moved with null', async () => {
		const kernel = await boot();
		const open = makeDesign(path.join(root, 'Work'), 'open');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: open }));
		value(await call(kernel, 'library:trashFolder', { path: path.join(root, 'Work') }));
		expect(kernel.host.trashed).toEqual([path.join(root, 'Work')]);
		expect(existsSync(path.join(root, 'Work'))).toBe(false);
		expect(kernel.root.store.openPaths()).toEqual([]);
		expect(movedMessages(kernel)).toEqual([{ from: open, to: null }]);
		expect(value(await call<LibraryFile[]>(kernel, 'files:recent'))).toEqual([]);
	});
});

describe('files', () => {
	it('renames a file on disk and its document name, keeping the recent entry', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Old');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: file }));
		await kernel.root.store.close(kernel.window.sender);
		const renamed = value(
			await call<LibraryFile>(kernel, 'library:renameFile', { path: file, name: 'New.ndesign' })
		);
		expect(renamed).toMatchObject({ path: path.join(root, 'New.ndesign'), name: 'New' });
		expect(existsSync(file)).toBe(false);
		const document = DocumentFile.open(renamed.path, { session: false });
		expect(document.info().name).toBe('New');
		document.close();
		const recent = value(await call<LibraryFile[]>(kernel, 'files:recent'));
		expect(recent.map((entry) => entry.path)).toEqual([renamed.path]);
		expect(recent[0].openedAt).toBeTypeOf('number');
	});

	it('refuses renaming onto an existing file', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'a');
		makeDesign(root, 'b');
		expect(failureOf(await call(kernel, 'library:renameFile', { path: file, name: 'b' }))).toMatch(
			/already exists/
		);
		expect(existsSync(file)).toBe(true);
	});

	it('renaming the open file reopens it for the window and pushes files:moved', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Old');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: file }));
		const renamed = value(
			await call<LibraryFile>(kernel, 'library:renameFile', { path: file, name: 'New' })
		);
		expect(kernel.root.store.openPaths()).toEqual([renamed.path]);
		expect(movedMessages(kernel)).toEqual([{ from: file, to: renamed.path }]);
		const reloaded = value(await call<LoadedDocument>(kernel, 'store:load'));
		expect(reloaded.info).toMatchObject({ path: renamed.path, name: 'New', inLibrary: true });
		expect(kernel.window.sent.filter((m) => m.channel === 'files:flush-request')).not.toHaveLength(
			0
		);
	});

	it('moves a file into a folder, numbering on a name clash, and follows an open document', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Logo');
		makeDesign(path.join(root, 'Work'), 'Logo');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: file }));
		const moved = value(
			await call<LibraryFile>(kernel, 'library:moveFile', {
				path: file,
				directory: path.join(root, 'Work')
			})
		);
		expect(moved.path).toBe(path.join(root, 'Work', 'Logo 2.ndesign'));
		expect(moved.location).toEqual({ kind: 'library', folder: 'Work' });
		expect(kernel.root.store.openPaths()).toEqual([moved.path]);
		expect(movedMessages(kernel)).toEqual([{ from: file, to: moved.path }]);
		expect(DocumentFile.open(moved.path, { session: false }).info().name).toBe('Logo 2');
		const back = value(
			await call<LibraryFile>(kernel, 'library:moveFile', { path: moved.path, directory: root })
		);
		expect(back.path).toBe(path.join(root, 'Logo 2.ndesign'));
	});

	it('moving into the directory a file is already in changes nothing', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Logo');
		const same = value(
			await call<LibraryFile>(kernel, 'library:moveFile', { path: file, directory: root })
		);
		expect(same.path).toBe(file);
		expect(movedMessages(kernel)).toEqual([]);
	});

	it('duplicates a file next to the original, with the open file’s latest state', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Logo');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: file }));
		const first = value(await call<LibraryFile>(kernel, 'library:duplicateFile', { path: file }));
		const second = value(await call<LibraryFile>(kernel, 'library:duplicateFile', { path: file }));
		expect(first.path).toBe(path.join(root, 'Logo copy.ndesign'));
		expect(second.path).toBe(path.join(root, 'Logo copy 2.ndesign'));
		expect(kernel.root.store.openPaths()).toEqual([file]);
		const copy = DocumentFile.open(first.path, { session: false });
		expect(copy.info().name).toBe('Logo copy');
		expect(copy.load().nodes).toEqual(richDocument().nodes);
		copy.close();
	});

	it('trashes a file; an open one is closed and files:moved goes out with null', async () => {
		const kernel = await boot();
		const file = makeDesign(root, 'Logo');
		const keep = makeDesign(root, 'Keep');
		value(await call<LoadedDocument>(kernel, 'files:open', { path: file }));
		value(await call(kernel, 'library:trashFile', { path: file }));
		expect(kernel.host.trashed).toEqual([file]);
		expect(kernel.root.store.openPaths()).toEqual([]);
		expect(movedMessages(kernel)).toEqual([{ from: file, to: null }]);
		expect(value(await call<LibraryFile[]>(kernel, 'files:recent'))).toEqual([]);
		expect(existsSync(keep)).toBe(true);
	});
});

describe('linked folders', () => {
	it('adds a folder from the dialog, lists it and its subdirectories, and removes it again', async () => {
		const kernel = await boot();
		const repo = path.join(directory, 'repo');
		const designFile = makeDesign(path.join(repo, 'design'), 'Hero');
		const top = makeDesign(repo, 'Top');
		kernel.host.openDialogResult = [repo];
		const linked = value(await call<LinkedFolder>(kernel, 'library:linkFolder'));
		expect(linked).toMatchObject({ name: 'repo', path: repo, available: true });
		expect(kernel.host.lastOpenDialogRequest).toMatchObject({ directory: true });
		expect((await overview(kernel)).linked).toEqual([linked]);

		const listing = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: repo })
		);
		expect(listing.folders.map((folder) => folder.name)).toEqual(['design']);
		expect(listing.files).toMatchObject([
			{ path: top, location: { kind: 'linked', linkedId: linked.id, folder: '' } }
		]);
		const sub = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: path.join(repo, 'design') })
		);
		expect(sub.files).toMatchObject([
			{ path: designFile, location: { kind: 'linked', linkedId: linked.id, folder: 'design' } }
		]);

		value(await call(kernel, 'library:unlinkFolder', { id: linked.id }));
		expect((await overview(kernel)).linked).toEqual([]);
		expect(failureOf(await call(kernel, 'library:list', { directory: repo }))).toMatch(
			/neither in the library/
		);
		expect(existsSync(top)).toBe(true);
	});

	it('answers null when the dialog is cancelled and refuses the library itself', async () => {
		const kernel = await boot();
		kernel.host.openDialogResult = null;
		expect(value(await call(kernel, 'library:linkFolder'))).toBeNull();
		kernel.host.openDialogResult = [path.join(await overviewRoot(kernel), 'Work')];
		mkdirSync(path.join(root, 'Work'));
		expect(failureOf(await call(kernel, 'library:linkFolder'))).toMatch(/already part/);
	});

	it('marks a folder that vanished as unavailable and keeps it in the sidebar', async () => {
		const kernel = await boot();
		const repo = path.join(directory, 'repo');
		mkdirSync(repo);
		kernel.host.openDialogResult = [repo];
		const linked = value(await call<LinkedFolder>(kernel, 'library:linkFolder'));
		rmSync(repo, { recursive: true });
		expect((await overview(kernel)).linked).toEqual([{ ...linked, available: false }]);
		expect(failureOf(await call(kernel, 'library:list', { directory: repo }))).toMatch(
			/not an available directory/
		);
	});

	it('survives a restart and allows file operations inside a linked folder', async () => {
		const first = await boot();
		const repo = path.join(directory, 'repo');
		const file = makeDesign(repo, 'Shared');
		first.host.openDialogResult = [repo];
		value(await call(first, 'library:linkFolder'));
		const second = await boot();
		expect((await overview(second)).linked).toMatchObject([{ path: repo, available: true }]);
		const renamed = value(
			await call<LibraryFile>(second, 'library:renameFile', { path: file, name: 'Team' })
		);
		expect(renamed.path).toBe(path.join(repo, 'Team.ndesign'));
		const duplicate = value(
			await call<LibraryFile>(second, 'library:duplicateFile', { path: renamed.path })
		);
		expect(duplicate.location).toMatchObject({ kind: 'linked', folder: '' });
	});

	it('creates folders at the top of a linked folder', async () => {
		const kernel = await boot();
		const repo = path.join(directory, 'repo');
		mkdirSync(repo);
		kernel.host.openDialogResult = [repo];
		value(await call(kernel, 'library:linkFolder'));
		const folder = value(
			await call<LibraryFolder>(kernel, 'library:createFolder', { parent: repo, name: 'designs' })
		);
		expect(folder.path).toBe(path.join(repo, 'designs'));
	});
});

async function overviewRoot(kernel: Kernel): Promise<string> {
	return (await overview(kernel)).root;
}

describe('untitled migration', () => {
	function leaveUntitled(name: string, edited: boolean): string {
		const untitled = path.join(userData, 'untitled');
		mkdirSync(untitled, { recursive: true });
		const file = path.join(untitled, name);
		const initial = { ...richDocument(), name: 'Untitled' };
		const document = DocumentFile.create(file, initial);
		if (edited) {
			const recorder = new TransactionRecorder(initial);
			const [pageId] = Object.keys(initial.nodes);
			document.commit(
				recorder.edit('Rename page', planSetProps(recorder.store, pageId, { name: 'Edited' }))
			);
		}
		document.close();
		return file;
	}

	it('moves edited untitled files into the library, deletes empty ones and removes the directory', async () => {
		const edited = leaveUntitled('untitled-1.ndesign', true);
		const second = leaveUntitled('untitled-2.ndesign', true);
		const empty = leaveUntitled('untitled-3.ndesign', false);
		const kernel = await boot();
		expect(existsSync(edited)).toBe(false);
		expect(existsSync(second)).toBe(false);
		expect(existsSync(empty)).toBe(false);
		expect(existsSync(path.join(userData, 'untitled'))).toBe(false);
		expect(readdirSync(root).sort()).toEqual(['Untitled 2.ndesign', 'Untitled.ndesign']);
		const listing = value(
			await call<DirectoryListing>(kernel, 'library:list', { directory: root })
		);
		expect(listing.files.map((file) => file.name).sort()).toEqual(['Untitled', 'Untitled 2']);
		const migrated = DocumentFile.open(path.join(root, 'Untitled 2.ndesign'), { session: false });
		expect(migrated.info().name).toBe('Untitled 2');
		migrated.close();
	});

	it('does nothing without a leftover directory and never creates the library for it', async () => {
		await boot();
		expect(existsSync(root)).toBe(false);
	});
});
