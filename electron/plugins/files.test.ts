import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSetProps } from '../../src/lib/document/changes';
import type { DesignDocument } from '../../src/lib/document/types';
import type { CommitResult, IpcResult, LoadedDocument, RecentFile, StoreInfo } from '../bridge';
import type { FakeWindow } from '../kernel/fakeHost';
import { bootMinimalKernel, settle, type TestKernel } from '../kernel/testing';
import { DocumentFile } from '../store/documentFile';
import { richDocument } from '../store/testDocument';
import { TransactionRecorder } from '../store/testRecorder';
import { mainFilesPlugin } from './files';
import { mainStorePlugin } from './store';

let directory = '';
let userData = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'main-files-test-'));
	userData = path.join(directory, 'userData');
	mkdirSync(userData);
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

type Kernel = TestKernel & { window: FakeWindow };

async function boot(launchPaths: string[] = []): Promise<Kernel> {
	return bootMinimalKernel(
		[
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

function loaded(result: IpcResult<LoadedDocument | null>): LoadedDocument {
	const document = value(result);
	if (document === null) throw new Error('expected a document, got null (cancelled)');
	return document;
}

function untitledFiles(): string[] {
	const untitled = path.join(userData, 'untitled');
	if (!existsSync(untitled)) return [];
	return readdirSync(untitled).filter((name) => name.endsWith('.ndesign'));
}

/** Edit the open untitled document the way the renderer would: one persisted transaction. */
async function editUntitled(
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

describe('main-files plugin', () => {
	it('mounts its routes and listeners and unmounts leaving the host identical', async () => {
		const kernel = await bootMinimalKernel([{ plugin: mainStorePlugin }]);
		const before = kernel.host.snapshot();
		const fiber = kernel.root.plugin(mainFilesPlugin, {});
		await fiber;
		await settle();
		const mounted = kernel.host.snapshot();
		expect(mounted.handlers).toEqual(
			expect.arrayContaining([
				'files:newUntitled',
				'files:open',
				'files:openDialog',
				'files:saveDialog',
				'files:saveAs',
				'files:offerRecovery',
				'files:launchRequest',
				'files:recent',
				'files:clearRecent',
				'files:setThumbnail',
				'files:flushed'
			])
		);
		expect(mounted.appListeners).toMatchObject({ 'open-file': 1, 'second-instance': 1 });
		await fiber.dispose();
		await settle();
		expect(kernel.host.snapshot()).toEqual(before);
	});
});

describe('new untitled document', () => {
	it('creates a blank document in <userData>/untitled and makes it the window document', async () => {
		const kernel = await boot();
		const { info, document } = loaded(await call(kernel, 'files:newUntitled'));
		expect(info).toMatchObject({
			name: 'Untitled',
			untitled: true,
			unsaved: false,
			recovered: false
		});
		expect(path.dirname(info.path)).toBe(path.join(userData, 'untitled'));
		expect(Object.values(document.nodes).map((node) => node.name)).toEqual(['Page 1']);
		expect(untitledFiles()).toHaveLength(1);
		expect(kernel.root.store.openPaths()).toEqual([info.path]);
	});

	it('replacing an untitled document without edits deletes the temporary file silently', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		const second = loaded(await call(kernel, 'files:newUntitled'));
		expect(second.info.path).not.toBe(first.info.path);
		expect(untitledFiles()).toEqual([path.basename(second.info.path)]);
		expect(kernel.host.messageBoxRequests).toEqual([]);
	});

	it('asks before leaving an untitled document with edits: Cancel keeps it', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, first.document);
		kernel.host.messageBoxResult = 2;
		expect(value(await call(kernel, 'files:newUntitled'))).toBeNull();
		expect(kernel.host.messageBoxRequests[0]).toMatchObject({
			message: 'Save changes to "Untitled"?',
			buttons: ['Save…', "Don't Save", 'Cancel']
		});
		expect(kernel.root.store.openPaths()).toEqual([first.info.path]);
		expect(untitledFiles()).toHaveLength(1);
	});

	it("Don't Save replaces it and deletes the temporary file", async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, first.document);
		kernel.host.messageBoxResult = 1;
		const second = loaded(await call(kernel, 'files:newUntitled'));
		expect(untitledFiles()).toEqual([path.basename(second.info.path)]);
	});

	it('Save asks where, saves as that file, then replaces the document', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		const recorder = await editUntitled(kernel, first.document);
		kernel.host.messageBoxResult = 0;
		const target = path.join(directory, 'kept.ndesign');
		kernel.host.saveDialogResult = target;
		const second = loaded(await call(kernel, 'files:newUntitled'));
		expect(second.info.untitled).toBe(true);
		const kept = DocumentFile.open(target);
		expect(kept.load()).toEqual({ ...recorder.document, name: 'kept' });
		kept.close();
		expect(untitledFiles()).toEqual([path.basename(second.info.path)]);
	});

	it('Save then cancelling the save dialog cancels the whole action', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, first.document);
		kernel.host.messageBoxResult = 0;
		kernel.host.saveDialogResult = null;
		expect(value(await call(kernel, 'files:newUntitled'))).toBeNull();
		expect(kernel.root.store.openPaths()).toEqual([first.info.path]);
	});
});

describe('open', () => {
	it('opens a design file and returns its document', async () => {
		const target = path.join(directory, 'a.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		const opened = loaded(await call(kernel, 'files:open', { path: target }));
		expect(opened.document).toEqual(richDocument());
		expect(opened.info).toMatchObject({ path: target, untitled: false, unsaved: false });
	});

	it('a file that cannot be opened is a readable error and the window keeps its document', async () => {
		const kernel = await boot();
		const current = loaded(await call(kernel, 'files:newUntitled'));
		expect(
			failureOf(await call(kernel, 'files:open', { path: path.join(directory, 'nope') }))
		).toMatch(/^HANDLER_FAILED: .* does not exist$/);
		expect(kernel.root.store.openPaths()).toEqual([current.info.path]);
	});

	it('opening over an untitled document without edits discards the temporary file', async () => {
		const target = path.join(directory, 'a.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		loaded(await call(kernel, 'files:newUntitled'));
		loaded(await call(kernel, 'files:open', { path: target }));
		expect(untitledFiles()).toEqual([]);
	});
});

describe('save as', () => {
	it('copies the document, continues in the copy, and removes the untitled file', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		const recorder = await editUntitled(kernel, first.document);
		const target = path.join(directory, 'Saved Design.ndesign');

		const info = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: target }));
		expect(info).toMatchObject({
			path: target,
			name: 'Saved Design',
			untitled: false,
			unsaved: false,
			recovered: false
		});
		expect(untitledFiles()).toEqual([]);
		expect(kernel.root.store.openPaths()).toEqual([target]);

		const reloaded = value(await call<LoadedDocument>(kernel, 'store:load'));
		expect(reloaded.document).toEqual({ ...recorder.document, name: 'Saved Design' });
	});

	it('appends the extension, replaces an existing file, and keeps a titled source intact', async () => {
		const source = path.join(directory, 'source.ndesign');
		const original = richDocument();
		DocumentFile.create(source, original).close();
		const taken = path.join(directory, 'taken.ndesign');
		DocumentFile.create(taken, createOther()).close();
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: source }));

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
		expect(untouched.info().recovered).toBe(false);
		untouched.close();
	});

	it('saving as the current path is just a save', async () => {
		const target = path.join(directory, 'same.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: target }));
		const info = value(await call<StoreInfo>(kernel, 'files:saveAs', { path: target }));
		expect(info).toMatchObject({ path: target, unsaved: false });
		expect(readdirSync(directory).filter((name) => name.endsWith('.saving'))).toEqual([]);
	});

	it('saves edits that were persisted but never saved: the copy equals the document', async () => {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		const recorder = await editUntitled(kernel, first.document);
		const target = path.join(directory, 'copy.ndesign');
		value(await call<StoreInfo>(kernel, 'files:saveAs', { path: target }));
		await kernel.root.store.close(kernel.window.sender);
		const reopened = DocumentFile.open(target);
		expect(reopened.load()).toEqual({ ...recorder.document, name: 'copy' });
		reopened.close();
	});
});

function createOther(): DesignDocument {
	const other = richDocument();
	other.id = 'other';
	other.name = 'Other';
	return other;
}

describe('native dialogs', () => {
	it('the open dialog is filtered to design files and starts in Documents', async () => {
		const kernel = await boot();
		kernel.host.openDialogResult = ['/x/a.ndesign'];
		expect(value(await call(kernel, 'files:openDialog'))).toBe('/x/a.ndesign');
		expect(kernel.host.lastOpenDialogRequest).toMatchObject({
			multiple: false,
			defaultPath: path.join(directory, 'documents'),
			filters: [{ name: 'Neoworks Design', extensions: ['ndesign'] }]
		});
		kernel.host.openDialogResult = null;
		expect(value(await call(kernel, 'files:openDialog'))).toBeNull();
	});

	it('the save dialog suggests a name with the extension and forces it on the answer', async () => {
		const kernel = await boot();
		kernel.host.saveDialogResult = '/x/chosen';
		expect(value(await call(kernel, 'files:saveDialog', { suggestedName: 'Untitled' }))).toBe(
			'/x/chosen.ndesign'
		);
		expect(kernel.host.lastSaveDialogRequest).toMatchObject({
			defaultPath: path.join(directory, 'documents', 'Untitled.ndesign')
		});
		kernel.host.saveDialogResult = null;
		expect(value(await call(kernel, 'files:saveDialog', { suggestedName: 'x' }))).toBeNull();
	});
});

describe('recovery of untitled documents', () => {
	async function leaveEditedUntitled(): Promise<DesignDocument> {
		const kernel = await boot();
		const first = loaded(await call(kernel, 'files:newUntitled'));
		const recorder = await editUntitled(kernel, first.document);
		await kernel.root.fiber.dispose();
		await settle();
		return recorder.document;
	}

	it('offers to restore an untitled document an earlier run left, and restores it', async () => {
		const expected = await leaveEditedUntitled();
		const kernel = await boot();
		kernel.host.messageBoxResult = 0;
		const restored = loaded(await call(kernel, 'files:offerRecovery'));
		expect(kernel.host.messageBoxRequests[0]).toMatchObject({
			message: 'Restore "Untitled"?',
			buttons: ['Restore', 'Discard']
		});
		expect(restored.document).toEqual(expected);
		expect(restored.info).toMatchObject({ untitled: true, unsaved: true });
	});

	it('an untitled document left by a crash is offered too, flagged as recovered', async () => {
		const first = await boot();
		const opened = loaded(await call(first, 'files:newUntitled'));
		const recorder = await editUntitled(first, opened.document);
		// what kill -9 leaves behind: the file and its WAL, copied while the first run still has it open
		const crashedDirectory = path.join(directory, 'crashed-userData');
		mkdirSync(path.join(crashedDirectory, 'untitled'), { recursive: true });
		const crashed = path.join(crashedDirectory, 'untitled', path.basename(opened.info.path));
		for (const suffix of ['', '-wal', '-shm']) {
			if (existsSync(`${opened.info.path}${suffix}`)) {
				copyFileSync(`${opened.info.path}${suffix}`, `${crashed}${suffix}`);
			}
		}
		const second = await bootMinimalKernel(
			[{ plugin: mainStorePlugin }, { plugin: mainFilesPlugin, config: { flushTimeoutMs: 10 } }],
			{ paths: { userData: crashedDirectory } }
		);
		second.host.messageBoxResult = 0;
		const restored = loaded(await call(second, 'files:offerRecovery'));
		expect(restored.info.recovered).toBe(true);
		expect(restored.document).toEqual(recorder.document);
	});

	it('declining deletes the leftover; empty leftovers are removed without asking', async () => {
		await leaveEditedUntitled();
		const empty = path.join(userData, 'untitled', 'untitled-empty.ndesign');
		DocumentFile.create(empty).close();
		const kernel = await boot();
		kernel.host.messageBoxResult = 1;
		expect(value(await call(kernel, 'files:offerRecovery'))).toBeNull();
		expect(kernel.host.messageBoxRequests).toHaveLength(1);
		expect(untitledFiles()).toEqual([]);
	});

	it('offers nothing when nothing was left, and never offers the document that is open', async () => {
		const kernel = await boot();
		expect(value(await call(kernel, 'files:offerRecovery'))).toBeNull();
		expect(kernel.host.messageBoxRequests).toEqual([]);
		const opened = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, opened.document);
		expect(kernel.root.files.recoverable()).toEqual([]);
	});
});

describe('closing the window', () => {
	it('a saved document closes without asking', async () => {
		const target = path.join(directory, 'saved.ndesign');
		DocumentFile.create(target, richDocument()).close();
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: target }));
		expect(await kernel.window.requestClose()).toBe(true);
		expect(kernel.host.messageBoxRequests).toEqual([]);
		await settle();
		expect(kernel.root.store.openPaths()).toEqual([]);
	});

	it('an untitled document without edits closes silently and its file is removed', async () => {
		const kernel = await boot();
		loaded(await call(kernel, 'files:newUntitled'));
		expect(await kernel.window.requestClose()).toBe(true);
		expect(kernel.host.messageBoxRequests).toEqual([]);
		expect(untitledFiles()).toEqual([]);
	});

	it('an untitled document with edits asks: Cancel keeps the window, Do not save closes', async () => {
		const kernel = await boot();
		const opened = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, opened.document);

		kernel.host.messageBoxResult = 2;
		expect(await kernel.window.requestClose()).toBe(false);
		expect(kernel.window.destroyed).toBe(false);
		expect(untitledFiles()).toHaveLength(1);

		kernel.host.messageBoxResult = 1;
		expect(await kernel.window.requestClose()).toBe(true);
		expect(untitledFiles()).toEqual([]);
	});

	it('Save saves into the chosen file and closes', async () => {
		const kernel = await boot();
		const opened = loaded(await call(kernel, 'files:newUntitled'));
		const recorder = await editUntitled(kernel, opened.document);
		const target = path.join(directory, 'on-close.ndesign');
		kernel.host.messageBoxResult = 0;
		kernel.host.saveDialogResult = target;
		expect(await kernel.window.requestClose()).toBe(true);
		const saved = DocumentFile.open(target);
		expect(saved.load()).toEqual({ ...recorder.document, name: 'on-close' });
		saved.close();
		expect(untitledFiles()).toEqual([]);
	});

	it('a quit never prompts: the untitled document stays for recovery', async () => {
		const kernel = await bootWithQuit();
		const opened = loaded(await call(kernel, 'files:newUntitled'));
		await editUntitled(kernel, opened.document);
		await kernel.root.parallel('app/before-quit');
		expect(await kernel.window.requestClose()).toBe(true);
		expect(kernel.host.messageBoxRequests).toEqual([]);
		expect(untitledFiles()).toHaveLength(1);
	});
});

async function bootWithQuit(): Promise<Kernel> {
	return boot();
}

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

	it('a quit flushes every window that has a document first', async () => {
		const kernel = await boot();
		loaded(await call(kernel, 'files:newUntitled'));
		const quitting = kernel.root.parallel('app/before-quit');
		const request = kernel.window.sent.find((message) => message.channel === 'files:flush-request');
		expect(request).toBeDefined();
		await quitting;
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
	function makeDesign(name: string): string {
		const target = path.join(directory, name);
		DocumentFile.create(target, richDocument()).close();
		return target;
	}

	async function recentPaths(kernel: Kernel): Promise<string[]> {
		return value(await call<RecentFile[]>(kernel, 'files:recent')).map((entry) => entry.path);
	}

	it('lists opened files newest first and reopening moves a file to the front', async () => {
		const first = makeDesign('a.ndesign');
		const second = makeDesign('b.ndesign');
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: first }));
		loaded(await call(kernel, 'files:open', { path: second }));
		expect(await recentPaths(kernel)).toEqual([second, first]);
		loaded(await call(kernel, 'files:open', { path: first }));
		expect(await recentPaths(kernel)).toEqual([first, second]);
		expect(kernel.host.osRecentDocuments).toEqual([first, second, first]);
	});

	it('records Save As destinations but never untitled documents', async () => {
		const kernel = await boot();
		loaded(await call(kernel, 'files:newUntitled'));
		expect(await recentPaths(kernel)).toEqual([]);
		const target = path.join(directory, 'saved.ndesign');
		value(await call(kernel, 'files:saveAs', { path: target }));
		expect(await recentPaths(kernel)).toEqual([target]);
	});

	it('prunes files that vanished when the list is read', async () => {
		const kept = makeDesign('kept.ndesign');
		const gone = makeDesign('gone.ndesign');
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: gone }));
		loaded(await call(kernel, 'files:open', { path: kept }));
		rmSync(gone);
		expect(await recentPaths(kernel)).toEqual([kept]);
		const reboot = await boot();
		expect(await recentPaths(reboot)).toEqual([kept]);
	});

	it('caps the list at 20 entries', async () => {
		const kernel = await boot();
		for (let index = 0; index < 22; index += 1) {
			loaded(await call(kernel, 'files:open', { path: makeDesign(`f${index}.ndesign`) }));
		}
		const paths = await recentPaths(kernel);
		expect(paths).toHaveLength(20);
		expect(paths[0]).toBe(path.join(directory, 'f21.ndesign'));
	});

	it('clearRecent empties the list and the OS list', async () => {
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: makeDesign('a.ndesign') }));
		value(await call(kernel, 'files:clearRecent'));
		expect(await recentPaths(kernel)).toEqual([]);
		expect(kernel.host.osRecentDocuments).toEqual([]);
	});

	it('returns the stored thumbnail of each file, null until one was written', async () => {
		const target = makeDesign('a.ndesign');
		const kernel = await boot();
		loaded(await call(kernel, 'files:open', { path: target }));
		expect(value(await call<RecentFile[]>(kernel, 'files:recent'))[0].thumbnail).toBeNull();
		const thumbnail = { mime: 'image/png', width: 2, height: 3, bytes: new Uint8Array([1, 2, 3]) };
		value(await call(kernel, 'files:setThumbnail', thumbnail));
		const [entry] = value(await call<RecentFile[]>(kernel, 'files:recent'));
		expect(entry.thumbnail).toEqual(thumbnail);
	});
});
