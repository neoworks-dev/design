import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import type { DesktopBridge, LoadedDocument, StoreInfo } from '../../../electron/bridge';
import { buildDocument, page } from '../../lib/document/fixtures';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { createBrowserBridge } from '../../lib/desktop/browserBridge';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import desktopBridge from '../desktop-bridge';
import fileSession from '../file-session';
import tabs from './index';

const user = { origin: 'user' as const, label: 'Edit' };

function infoOf(path: string, overrides: Partial<StoreInfo> = {}): StoreInfo {
	return {
		path,
		documentId: path,
		name: path.replace(/^.*\//, '').replace('.ndesign', ''),
		schemaVersion: 1,
		createdAt: 0,
		modifiedAt: 0,
		recovered: false,
		unsaved: false,
		untitled: false,
		...overrides
	};
}

function loadedAt(path: string, overrides: Partial<StoreInfo> = {}): LoadedDocument {
	const document = buildDocument([page(path)]);
	document.id = path;
	return { info: infoOf(path, overrides), document };
}

/** Main's side of the tab calls: one open file at a time, everything else stays on disk. */
class FakeBackend {
	readonly calls: string[] = [];
	readonly onDisk = new Map<string, LoadedDocument>();
	open: string | null = null;
	confirmClose = true;
	private untitledCount = 0;

	constructor() {
		this.onDisk.set('/docs/a.ndesign', loadedAt('/docs/a.ndesign'));
		this.onDisk.set('/docs/b.ndesign', loadedAt('/docs/b.ndesign'));
	}

	bridge(): Partial<DesktopBridge> {
		const base = createBrowserBridge();
		return {
			events: base.events,
			store: {
				...base.store,
				close: () => {
					this.calls.push('storeClose');
					this.open = null;
					return Promise.resolve();
				},
				commit: (transactions) => {
					this.calls.push(`commit:${transactions.length}`);
					return Promise.resolve({ committed: transactions.length, documentRows: 0 });
				}
			},
			files: {
				...base.files,
				open: (path) => this.switchTo(path, 'open'),
				openInTab: (path) => this.switchTo(path, 'openInTab'),
				newInTab: () => {
					this.untitledCount += 1;
					const path = `/untitled/u${this.untitledCount}.ndesign`;
					this.onDisk.set(path, loadedAt(path, { untitled: true, name: 'Untitled' }));
					return this.switchTo(path, 'newInTab');
				},
				confirmClose: () => {
					this.calls.push('confirmClose');
					return Promise.resolve(this.confirmClose);
				},
				discard: (path) => {
					this.calls.push(`discard:${path}`);
					this.onDisk.delete(path);
					return Promise.resolve();
				},
				newUntitled: () => {
					this.untitledCount += 1;
					const path = `/untitled/u${this.untitledCount}.ndesign`;
					this.onDisk.set(path, loadedAt(path, { untitled: true, name: 'Untitled' }));
					return this.switchTo(path, 'newUntitled');
				},
				flushed: () => Promise.resolve()
			}
		};
	}

	private switchTo(path: string, call: string): Promise<LoadedDocument> {
		this.calls.push(`${call}:${path}`);
		const found = this.onDisk.get(path);
		if (found === undefined) return Promise.reject(new Error(`no such file ${path}`));
		this.open = path;
		return Promise.resolve(found);
	}
}

function sessionWithoutStartup(): Plugin.Object {
	return {
		...fileSession,
		apply: (ctx: Context) => fileSession.apply(ctx, { startup: 'none', delayMs: 0 })
	};
}

const providers = (): Plugin[] => [
	...editingProviders(buildDocument([page('Seed')])),
	desktopBridge,
	sessionWithoutStartup()
];

async function mount(backend: FakeBackend): Promise<MountedPlugin> {
	return mountPlugin(tabs, { providers: providers(), desktop: backend.bridge() });
}

/** Start the way the app does: the session opens a first document, the tab follows. */
async function startWithFileA(mounted: MountedPlugin, backend: FakeBackend): Promise<void> {
	await mounted.ctx.fileSession.openDocument('/docs/a.ndesign');
	expect(backend.calls).toEqual(['open:/docs/a.ndesign']);
	backend.calls.length = 0;
}

function titles(ctx: Context): string[] {
	return ctx.tabs.tabs.map((tab) => ctx.tabs.nameOf(tab));
}

describePlugin('tabs', tabs, {
	providers: providers(),
	desktop: new FakeBackend().bridge(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('tabs.new')).toBe(true);
		expect(ctx.commands.has('tabs.close')).toBe(true);
		expect(ctx.commands.has('tabs.next')).toBe(true);
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toContain('tabs/strip');
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+tab');
		expect(chords).toContain('ctrl+w');
	}
});

describe('tabs follow the session', () => {
	it('the first document becomes the first tab', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		expect(titles(mounted.ctx)).toEqual(['a']);
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/a.ndesign');
		await mounted.cleanup();
	});

	it('File > Open and New open tabs instead of replacing the document', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		await mounted.ctx.fileSession.newDocument();
		expect(titles(mounted.ctx)).toEqual(['a', 'b', 'Untitled']);
		expect(backend.calls).toEqual(['openInTab:/docs/b.ndesign', 'newInTab:/untitled/u1.ndesign']);
		expect(mounted.ctx.tabs.activeTab?.untitled).toBe(true);
		await mounted.cleanup();
	});

	it('opening a file that is already a tab activates it', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		await mounted.ctx.fileSession.openDocument('/docs/a.ndesign');
		expect(mounted.ctx.tabs.tabs).toHaveLength(2);
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/a.ndesign');
		await mounted.cleanup();
	});

	it('Save As relabels the active tab instead of adding one', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		mounted.ctx.fileSession.attach(infoOf('/docs/renamed.ndesign'));
		expect(mounted.ctx.tabs.tabs).toHaveLength(1);
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/renamed.ndesign');
		await mounted.cleanup();
	});
});

describe('switching', () => {
	it('two documents edit independently: edits are persisted before the switch and a tab remembers its page', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		const { document, tabs: service } = mounted.ctx;
		const [tabA] = service.tabs;
		const [firstPage] = document.pages();
		document.apply(document.setProps(firstPage.id, { name: 'edited in a' }), user);

		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		expect(backend.calls).toEqual(['commit:1', 'openInTab:/docs/b.ndesign']);
		expect(document.pages().map((entry) => entry.name)).toEqual(['/docs/b.ndesign']);

		await service.activate(tabA.id);
		expect(backend.open).toBe('/docs/a.ndesign');
		expect(service.activeId).toBe(tabA.id);
		await mounted.cleanup();
	});

	it('only one file is open at a time however many tabs there are', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.tabs.newTab();
		await mounted.ctx.tabs.newTab();
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		expect(mounted.ctx.tabs.tabs).toHaveLength(4);
		expect(backend.open).toBe('/docs/b.ndesign');
		await mounted.cleanup();
	});

	it('a tab whose file vanished is dropped and the window keeps its document', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		const [tabA] = mounted.ctx.tabs.tabs;
		backend.onDisk.delete('/docs/a.ndesign');
		await expect(mounted.ctx.tabs.activate(tabA.id)).rejects.toThrow('no such file');
		expect(titles(mounted.ctx)).toEqual(['b']);
		await mounted.cleanup();
	});

	it('Ctrl+Tab style cycling wraps around', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		await mounted.ctx.commands.run('tabs.next');
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/a.ndesign');
		await mounted.ctx.commands.run('tabs.previous');
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/b.ndesign');
		await mounted.cleanup();
	});

	it('reordering moves a tab without changing the active one', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		const [tabA, tabB] = mounted.ctx.tabs.tabs;
		mounted.ctx.tabs.move(tabB.id, 0);
		expect(titles(mounted.ctx)).toEqual(['b', 'a']);
		mounted.ctx.tabs.move(tabB.id, 2);
		expect(titles(mounted.ctx)).toEqual(['a', 'b']);
		expect(mounted.ctx.tabs.activeId).toBe(tabB.id);
		expect(tabA.path).toBe('/docs/a.ndesign');
		await mounted.cleanup();
	});
});

describe('closing', () => {
	it('closing the active tab shows its right neighbour, else the left one', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		await mounted.ctx.tabs.closeActive();
		expect(titles(mounted.ctx)).toEqual(['a']);
		expect(backend.open).toBe('/docs/a.ndesign');
		await mounted.cleanup();
	});

	it('a background saved tab closes without touching the file or asking', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		backend.calls.length = 0;
		const [tabA] = mounted.ctx.tabs.tabs;
		await mounted.ctx.tabs.close(tabA.id);
		expect(titles(mounted.ctx)).toEqual(['b']);
		expect(backend.calls).toEqual([]);
		await mounted.cleanup();
	});

	it('an untitled tab asks main; cancelling keeps it, confirming discards its file', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.tabs.newTab();
		backend.confirmClose = false;
		await mounted.ctx.tabs.closeActive();
		expect(titles(mounted.ctx)).toEqual(['a', 'Untitled']);
		backend.confirmClose = true;
		await mounted.ctx.tabs.closeActive();
		expect(titles(mounted.ctx)).toEqual(['a']);
		expect(backend.calls).toContain('discard:/untitled/u1.ndesign');
		expect(backend.onDisk.has('/untitled/u1.ndesign')).toBe(false);
		await mounted.cleanup();
	});

	it('closing the last tab closes the document (the home screen) and a new one starts a tab again', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.tabs.closeActive();
		expect(mounted.ctx.tabs.tabs).toEqual([]);
		expect(backend.open).toBeNull();
		expect(mounted.ctx.contextKeys.get('document.closed')).toBe(true);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		expect(titles(mounted.ctx)).toEqual(['b']);
		expect(mounted.ctx.contextKeys.get('document.closed')).toBe(false);
		await mounted.cleanup();
	});

	it('reopen closed tab brings back the last closed saved document', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await startWithFileA(mounted, backend);
		await mounted.ctx.fileSession.openDocument('/docs/b.ndesign');
		const [tabA] = mounted.ctx.tabs.tabs;
		await mounted.ctx.tabs.close(tabA.id);
		expect(mounted.ctx.tabs.canReopenClosed).toBe(true);
		await mounted.ctx.commands.run('tabs.reopen-closed');
		expect(titles(mounted.ctx)).toEqual(['b', 'a']);
		expect(mounted.ctx.tabs.activeTab?.path).toBe('/docs/a.ndesign');
		expect(mounted.ctx.tabs.canReopenClosed).toBe(false);
		await mounted.cleanup();
	});
});
