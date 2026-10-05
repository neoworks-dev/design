import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommitResult, DesktopBridge, StoreInfo } from '../../../electron/bridge';
import { DocumentFile } from '../../../electron/store/documentFile';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import desktopBridge from '../../plugins/desktop-bridge';
import fileSessionPlugin from '../../plugins/file-session';
import { FiberState, type Context, type Plugin } from '@neoworks/extension-system';
import type { Transaction } from '../document';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import { documentWith, sampleDocument } from './fixtures/documentFixture';

const user = { origin: 'user' as const, label: 'Edit' };

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'file-session-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

/** A store bridge that records every commit, can be held pending or failed, or writes to a file. */
class FakeStore {
	readonly batches: Transaction[][] = [];
	failNext: string | null = null;
	hold: Promise<void> | null = null;
	file: DocumentFile | null = null;

	bridge: DesktopBridge['store'] = {
		open: () => Promise.reject(new Error('not used')),
		create: () => Promise.reject(new Error('not used')),
		load: () => Promise.reject(new Error('not used')),
		close: () => Promise.resolve(),
		checkpoint: () => Promise.reject(new Error('not used')),
		commit: async (transactions): Promise<CommitResult> => {
			this.batches.push(transactions);
			if (this.hold) await this.hold;
			if (this.failNext !== null) {
				const message = this.failNext;
				this.failNext = null;
				throw new Error(message);
			}
			let documentRows = 0;
			if (this.file) {
				for (const transaction of transactions) {
					documentRows += this.file.commit(transaction).documentRows;
				}
			}
			return { committed: transactions.length, documentRows };
		}
	};
}

const info: StoreInfo = {
	path: '/tmp/x.ndesign',
	documentId: 'd',
	name: 'x',
	schemaVersion: 1,
	createdAt: 0,
	modifiedAt: 0,
	recovered: false,
	inLibrary: true
};

const keymap: Plugin.Object = {
	...coreKeymap,
	apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' })
};

function providers(): Parameters<typeof mountPlugin>[1] {
	return {
		providers: [
			coreContextKeys,
			coreCommands,
			keymap,
			documentWith(sampleDocument()),
			desktopBridge
		]
	};
}

describePlugin('file-session', fileSessionPlugin, {
	...providers(),
	desktop: true,
	config: { startup: 'none' },
	contributes: ({ ctx }) => {
		expect(ctx.fileSession.isAttached).toBe(false);
		expect(ctx.fileSession.status).toMatchObject({ queued: 0, inFlight: 0, error: null });
	}
});

interface Timers {
	callbacks: (() => void)[];
	fire(): void;
}

async function mount(
	store: FakeStore,
	timers: Timers = manualTimers()
): Promise<MountedPlugin & { timers: Timers }> {
	const mounted = await mountPlugin(fileSessionPlugin, {
		...providers(),
		desktop: { store: store.bridge },
		config: {
			delayMs: 50,
			startup: 'none',
			schedule: (callback: () => void) => {
				timers.callbacks.push(callback);
				return timers.callbacks.length;
			},
			cancel: () => {
				timers.callbacks.length = 0;
			}
		}
	});
	return Object.assign(mounted, { timers });
}

function manualTimers(): Timers {
	const timers: Timers = {
		callbacks: [],
		fire() {
			const due = timers.callbacks.splice(0);
			for (const callback of due) callback();
		}
	};
	return timers;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe('autosave', () => {
	it('does nothing without an attached file', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		mounted.ctx.document.apply(mounted.ctx.document.setProps('n3', { name: 'a' }), user);
		mounted.timers.fire();
		expect(store.batches).toEqual([]);
		await mounted.cleanup();
	});

	it('sends each committed transaction to main after the debounce, coalescing a burst', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		document.apply(document.setProps('n4', { name: 'b' }), user);
		expect(store.batches).toEqual([]);
		expect(fileSession.status.queued).toBe(2);

		mounted.timers.fire();
		await settle();
		expect(store.batches).toHaveLength(1);
		expect(store.batches[0].map((transaction) => transaction.label)).toEqual(['Edit', 'Edit']);
		expect(fileSession.status).toMatchObject({ queued: 0, inFlight: 0, persisted: 2 });
		await mounted.cleanup();
	});

	it('sends undo and redo too: they are transactions like any other', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		const transaction = document.apply(document.setProps('n3', { name: 'a' }), user);
		document.apply(transaction.undo, { ...user, replay: 'undo' });
		await fileSession.flush();
		expect(store.batches[0]).toHaveLength(2);
		await mounted.cleanup();
	});

	it('flush sends at once; blur and hide flush too', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		await fileSession.flush();
		expect(store.batches).toHaveLength(1);

		document.apply(document.setProps('n3', { name: 'b' }), user);
		window.dispatchEvent(new Event('blur'));
		await settle();
		expect(store.batches).toHaveLength(2);

		document.apply(document.setProps('n3', { name: 'c' }), user);
		globalThis.document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(store.batches).toHaveLength(3);

		document.apply(document.setProps('n3', { name: 'd' }), user);
		window.dispatchEvent(new Event('beforeunload'));
		await settle();
		expect(store.batches).toHaveLength(4);
		await mounted.cleanup();
	});

	it('applies backpressure: later transactions wait for the reply, in order', async () => {
		const store = new FakeStore();
		let release: () => void = () => {};
		store.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		mounted.timers.fire();
		await settle();
		document.apply(document.setProps('n3', { name: 'b' }), user);
		document.apply(document.setProps('n3', { name: 'c' }), user);
		mounted.timers.fire();
		expect(store.batches).toHaveLength(1);
		expect(fileSession.status).toMatchObject({ queued: 2, inFlight: 1 });

		store.hold = null;
		release();
		await settle();
		mounted.timers.fire();
		await settle();
		expect(store.batches.map((batch) => batch.length)).toEqual([1, 2]);
		await mounted.cleanup();
	});

	it('keeps transactions on failure, reports the error and delivers them on retry', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		store.failNext = 'DISK_FULL: no space left';
		document.apply(document.setProps('n3', { name: 'a' }), user);
		mounted.timers.fire();
		await settle();
		expect(fileSession.status.error).toBe('DISK_FULL: no space left');
		expect(fileSession.status.inFlight).toBe(1);

		mounted.timers.fire();
		await settle();
		expect(fileSession.status).toMatchObject({ error: null, inFlight: 0, persisted: 1 });
		expect(store.batches).toHaveLength(2);
		await mounted.cleanup();
	});

	it('detach flushes first, then stops recording', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		await fileSession.detach();
		expect(store.batches).toHaveLength(1);
		expect(fileSession.isAttached).toBe(false);
		document.apply(document.setProps('n3', { name: 'b' }), user);
		await fileSession.flush();
		expect(store.batches).toHaveLength(1);
		await mounted.cleanup();
	});

	it('unmounting saves what is queued and leaves no timers or listeners behind', async () => {
		const store = new FakeStore();
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach(info);
		document.apply(document.setProps('n3', { name: 'a' }), user);
		expect(mounted.fiber.state).toBe(FiberState.ACTIVE);
		await mounted.fiber.dispose();
		await settle();
		expect(store.batches).toHaveLength(1);
		const after = mounted.currentState();
		expect(after.domListeners).toEqual(mounted.snapshot.domListeners);
		expect(after.listeners).toEqual(mounted.snapshot.listeners);
		expect(after.effects).toEqual(mounted.snapshot.effects);
		expect(after.timers).toBe(0);
		await mounted.cleanup();
	});
});

describe('end to end with the real store', () => {
	it('a session of edits, undo and redo ends with a file that equals the document', async () => {
		const store = new FakeStore();
		const target = path.join(directory, 'live.ndesign');
		store.file = DocumentFile.create(target, sampleDocument());
		const mounted = await mount(store);
		const { document, fileSession } = mounted.ctx;
		fileSession.attach({ ...info, path: target });

		document.apply(document.setProps('n3', { name: 'Renamed', width: 321 }), user);
		document.apply(document.moveNode('n4', 'n5', 0), user);
		document.apply(document.removeNode('n6'), user);
		const last = document.apply(document.setProps('n2', { name: 'Frame' }), user);
		document.apply(last.undo, { ...user, replay: 'undo' });
		await fileSession.flush();

		store.file.close();
		const reopened = DocumentFile.open(target);
		expect(reopened.load()).toEqual(document.snapshot);
		reopened.close();
		await mounted.cleanup();
	});
});
