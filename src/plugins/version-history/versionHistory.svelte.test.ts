import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesktopBridge, StoreInfo } from '../../../electron/bridge';
import { DocumentFile } from '../../../electron/store/documentFile';
import { pruneTransactionLog } from '../../../electron/store/transactionWriter';
import { panelProviders } from '../../lib/editing/fixtures/panelHarness';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import desktopBridge from '../desktop-bridge';
import fileSessionPlugin from '../file-session';
import versionHistory from './index';

const fileSession: Plugin.Object = {
	...fileSessionPlugin,
	apply: (ctx: Context) => fileSessionPlugin.apply(ctx, { startup: 'none', delayMs: 1 })
};
// Built per call: the document plugin edits the fixture document in place.
function providers(): Plugin[] {
	return [...panelProviders(), desktopBridge, fileSession];
}

describePlugin('version-history', versionHistory, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.versionHistory).toBeDefined();
		expect(ctx.panels.tabs('left').map((tab) => tab.id)).toContain('version-history');
		expect(ctx.commands.has('version.save')).toBe(true);
		expect(ctx.commands.has('version.showHistory')).toBe(true);
	}
});

let directory = '';
let file: DocumentFile | null = null;
let session: (MountedPlugin & { target?: HTMLElement }) | null = null;
let rendered: ReturnType<typeof mount> | null = null;
let target: HTMLElement | null = null;

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'version-history-test-'));
});
afterEach(async () => {
	if (rendered) await unmount(rendered);
	rendered = null;
	target?.remove();
	target = null;
	await session?.cleanup();
	session = null;
	file?.close();
	file = null;
	rmSync(directory, { recursive: true, force: true });
});

function bridgeFor(documentFile: DocumentFile): Partial<DesktopBridge> {
	return {
		store: {
			open: () => Promise.reject(new Error('not used')),
			create: () => Promise.reject(new Error('not used')),
			load: () => Promise.reject(new Error('not used')),
			close: () => Promise.resolve(),
			checkpoint: () => Promise.reject(new Error('not used')),
			commit: (transactions) => {
				let documentRows = 0;
				for (const transaction of transactions) {
					documentRows += documentFile.commit(transaction).documentRows;
				}
				return Promise.resolve({ committed: transactions.length, documentRows });
			}
		},
		versions: {
			list: () => Promise.resolve(documentFile.versionHistory()),
			add: (name) => Promise.resolve(documentFile.addVersion(name)),
			remove: (id) => Promise.resolve(documentFile.deleteVersion(id)),
			restorePlan: (seq) => Promise.resolve(documentFile.restorePlan(seq))
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
	unsaved: false,
	untitled: false
};

/** The plugin mounted over a real SQLite file that holds the same document. */
async function open(): Promise<MountedPlugin> {
	const first = await mountPlugin(versionHistory, { providers: providers(), desktop: true });
	const snapshot = first.ctx.document.snapshot;
	await first.cleanup();
	file = DocumentFile.create(path.join(directory, 'doc.ndesign'), snapshot);
	const mounted = await mountPlugin(versionHistory, {
		providers: providers(),
		desktop: bridgeFor(file)
	});
	mounted.ctx.fileSession.attach(info);
	session = mounted;
	return mounted;
}

function nameOf(ctx: Context, id: string): string {
	return ctx.document.require(id).name;
}

async function rename(ctx: Context, name: string): Promise<void> {
	ctx.document.apply(ctx.document.setProps('a', { name }), { origin: 'user', label: `To ${name}` });
	await ctx.fileSession.flush();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('restore', () => {
	it('goes back to a named version as one undoable step, and undo brings the edits back', async () => {
		const { ctx } = await open();
		const original = nameOf(ctx, 'a');
		await rename(ctx, 'one');
		const mark = await ctx.versionHistory.saveVersion('Good one');
		await rename(ctx, 'two');
		await rename(ctx, 'three');
		expect(nameOf(ctx, 'a')).toBe('three');
		expect(mark).not.toBeNull();

		const changed = await ctx.versionHistory.restore(mark?.seq ?? -1, 'Good one');
		expect(changed).toBe(true);
		expect(nameOf(ctx, 'a')).toBe('one');

		expect(ctx.history.undo()).toBe(true);
		expect(nameOf(ctx, 'a')).toBe('three');
		ctx.history.redo();
		expect(nameOf(ctx, 'a')).toBe('one');
		expect(original).not.toBe('one');
	});

	it('restores a point in the changes list, including structure changes', async () => {
		const { ctx } = await open();
		await rename(ctx, 'one');
		const afterOne = ctx.versionHistory.data;
		await ctx.versionHistory.refresh();
		const seqAfterOne = ctx.versionHistory.entries[0].seq;
		expect(afterOne).toBeDefined();
		ctx.document.apply(ctx.document.removeNode('b'), { origin: 'user', label: 'Delete b' });
		await ctx.fileSession.flush();
		expect(ctx.document.has('b')).toBe(false);

		await ctx.versionHistory.restore(seqAfterOne, 'To one');
		expect(ctx.document.has('b')).toBe(true);
		expect(nameOf(ctx, 'a')).toBe('one');
	});

	it('flushes the autosave queue first, so the newest unsaved edits are undone too', async () => {
		const { ctx } = await open();
		await rename(ctx, 'one');
		const mark = await ctx.versionHistory.saveVersion('Mark');
		ctx.document.apply(ctx.document.setProps('a', { name: 'unflushed' }), {
			origin: 'user',
			label: 'Not persisted yet'
		});
		await ctx.versionHistory.restore(mark?.seq ?? -1, 'Mark');
		expect(nameOf(ctx, 'a')).toBe('one');
	});

	it('says so and changes nothing when the version was pruned', async () => {
		const { ctx } = await open();
		await rename(ctx, 'one');
		const mark = await ctx.versionHistory.saveVersion('Old');
		for (const name of ['two', 'three', 'four']) await rename(ctx, name);
		if (file) pruneTransactionLog(file.requireOpen(), Date.now(), { maxRows: 2, maxAgeDays: 30 });
		await ctx.versionHistory.refresh();

		expect(ctx.versionHistory.hasPrunedRange).toBe(true);
		expect(ctx.versionHistory.isRestorable(mark?.seq ?? -1)).toBe(false);
		const changed = await ctx.versionHistory.restore(mark?.seq ?? -1, 'Old');
		expect(changed).toBe(false);
		expect(nameOf(ctx, 'a')).toBe('four');
		expect(ctx.versionHistory.notice?.kind).toBe('error');
		expect(ctx.versionHistory.notice?.text).toContain('pruned');
	});

	it('still restores a recent point after pruning', async () => {
		const { ctx } = await open();
		for (const name of ['one', 'two', 'three', 'four']) await rename(ctx, name);
		if (file) pruneTransactionLog(file.requireOpen(), Date.now(), { maxRows: 2, maxAgeDays: 30 });
		await ctx.versionHistory.refresh();
		const recent = ctx.versionHistory.entries[1];
		expect(ctx.versionHistory.isRestorable(recent.seq)).toBe(true);
		await ctx.versionHistory.restore(recent.seq, recent.label);
		expect(nameOf(ctx, 'a')).toBe('three');
	});

	it('restoring the current state reports that nothing changed', async () => {
		const { ctx } = await open();
		await rename(ctx, 'one');
		const mark = await ctx.versionHistory.saveVersion('Now');
		expect(await ctx.versionHistory.restore(mark?.seq ?? -1, 'Now')).toBe(false);
		expect(ctx.versionHistory.notice?.text).toContain('already');
	});
});

describe('panel', () => {
	async function render(): Promise<{ ctx: Context; root: HTMLElement }> {
		const { ctx } = await open();
		await rename(ctx, 'one');
		await ctx.versionHistory.saveVersion('Milestone');
		await rename(ctx, 'two');
		target = document.createElement('div');
		document.body.append(target);
		rendered = mount(HostRoot, { target, props: { ctx, region: 'left' } });
		ctx.panels.activateTab('version-history');
		await settle();
		return { ctx, root: target };
	}

	it('lists versions and changes with origin badges and restores from the button', async () => {
		const { ctx, root } = await render();
		expect(
			root.querySelector('[data-version-mark][data-version-kind="named"]')?.textContent
		).toContain('Milestone');
		const origins = [...root.querySelectorAll('[data-version-origin]')].map((badge) =>
			badge.getAttribute('data-version-origin')
		);
		expect(origins).toEqual(['user', 'user']);

		const restore = [
			...(root
				.querySelector('[data-version-mark][data-version-kind="named"]')
				?.querySelectorAll('button') ?? [])
		].find((button) => button.textContent.trim() === 'Restore');
		restore?.click();
		await settle();
		expect(nameOf(ctx, 'a')).toBe('one');
		expect(root.querySelector('[data-version-notice="info"]')?.textContent).toContain('Restored');
	});

	it('shows the pruned message and disables restore for pruned versions', async () => {
		const { ctx, root } = await render();
		for (const name of ['three', 'four', 'five']) await rename(ctx, name);
		if (file) pruneTransactionLog(file.requireOpen(), Date.now(), { maxRows: 2, maxAgeDays: 30 });
		await ctx.versionHistory.refresh();
		await settle();
		expect(root.querySelector('[data-version-pruned-range]')).not.toBeNull();
		const milestone = root.querySelector('[data-version-kind="named"]');
		expect(milestone?.getAttribute('data-restorable')).toBe('false');
		expect(milestone?.querySelector('[data-version-pruned]')).not.toBeNull();
		const restore = [...(milestone?.querySelectorAll('button') ?? [])].find(
			(button) => button.textContent.trim() === 'Restore'
		);
		expect(restore?.hasAttribute('disabled')).toBe(true);
	});
});
