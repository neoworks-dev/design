import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import type {
	CommitResult,
	DesktopBridge,
	LoadedDocument,
	StoreInfo
} from '../../../electron/bridge';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import desktopBridge from '../../plugins/desktop-bridge';
import fileSessionPlugin from '../../plugins/file-session';
import { createBrowserBridge, type BrowserBridge } from '../desktop/browserBridge';
import { buildDocument, page } from '../document/fixtures';
import { mountPlugin, type MountedPlugin } from '../kernel/testing';
import { documentWith, sampleDocument } from './fixtures/documentFixture';

const user = { origin: 'user' as const, label: 'Edit' };

function infoOf(overrides: Partial<StoreInfo> = {}): StoreInfo {
	return {
		path: '/docs/a.ndesign',
		documentId: 'd',
		name: 'a',
		schemaVersion: 1,
		createdAt: 0,
		modifiedAt: 0,
		recovered: false,
		unsaved: false,
		untitled: false,
		...overrides
	};
}

function loadedPage(name: string, info: Partial<StoreInfo> = {}): LoadedDocument {
	const document = buildDocument([page(name)]);
	document.id = `doc-${name}`;
	return { info: infoOf({ documentId: document.id, ...info }), document };
}

/** A scriptable `files` and `store` bridge that records the order of calls. */
class FakeBackend {
	readonly calls: string[] = [];
	newUntitled: LoadedDocument | null = loadedPage('Fresh', { name: 'Untitled', untitled: true });
	opened: LoadedDocument | null = loadedPage('Opened', { name: 'opened' });
	openFailure: string | null = null;
	recovery: LoadedDocument | null = null;
	launch: string | null = null;
	openDialogResult: string | null = '/docs/chosen.ndesign';
	saveDialogResult: string | null = '/docs/saved.ndesign';
	suggestedNames: string[] = [];
	checkpointInfo: StoreInfo = infoOf();
	saveAsName = 'saved';

	store: DesktopBridge['store'] = {
		open: () => Promise.reject(new Error('not used')),
		create: () => Promise.reject(new Error('not used')),
		load: () => Promise.reject(new Error('not used')),
		close: () => Promise.resolve(),
		commit: (transactions): Promise<CommitResult> => {
			this.calls.push(`commit:${transactions.length}`);
			return Promise.resolve({ committed: transactions.length, documentRows: 0 });
		},
		checkpoint: () => {
			this.calls.push('checkpoint');
			return Promise.resolve(this.checkpointInfo);
		}
	};

	assets: DesktopBridge['assets'] = {
		put: () => Promise.reject(new Error('unused')),
		get: () => Promise.resolve(null),
		collect: () => Promise.resolve([]),
		embedFont: () => Promise.resolve(),
		fontBytes: () => Promise.resolve(null),
		embeddedFonts: () => Promise.resolve([])
	};

	files: DesktopBridge['files'] = {
		recent: () => Promise.resolve([]),
		clearRecent: () => Promise.resolve(),
		setThumbnail: () => Promise.resolve(),
		openInTab: () => Promise.reject(new Error('not used')),
		newInTab: () => Promise.reject(new Error('not used')),
		confirmClose: () => Promise.resolve(true),
		discard: () => Promise.resolve(),
		newUntitled: () => {
			this.calls.push('newUntitled');
			return Promise.resolve(this.newUntitled);
		},
		open: (path) => {
			this.calls.push(`open:${path}`);
			if (this.openFailure !== null) return Promise.reject(new Error(this.openFailure));
			return Promise.resolve(this.opened);
		},
		openDialog: () => {
			this.calls.push('openDialog');
			return Promise.resolve(this.openDialogResult);
		},
		saveDialog: (suggestedName) => {
			this.calls.push('saveDialog');
			this.suggestedNames.push(suggestedName);
			return Promise.resolve(this.saveDialogResult);
		},
		saveAs: (path) => {
			this.calls.push(`saveAs:${path}`);
			return Promise.resolve(
				infoOf({ path, name: this.saveAsName, untitled: false, unsaved: false })
			);
		},
		offerRecovery: () => {
			this.calls.push('offerRecovery');
			return Promise.resolve(this.recovery);
		},
		launchRequest: () => {
			this.calls.push('launchRequest');
			return Promise.resolve(this.launch);
		},
		flushed: (requestId) => {
			this.calls.push(`flushed:${requestId}`);
			return Promise.resolve();
		},
		pathForFile: (file) => `/dropped/${file.name}`
	};
}

const keymap: Plugin.Object = {
	...coreKeymap,
	apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' })
};

async function mount(
	backend: FakeBackend,
	startup: 'auto' | 'none' = 'none'
): Promise<MountedPlugin & { emit: BrowserBridge['emit'] }> {
	const base = createBrowserBridge();
	const mounted = await mountPlugin(fileSessionPlugin, {
		providers: [
			coreContextKeys,
			coreCommands,
			keymap,
			documentWith(sampleDocument()),
			desktopBridge
		],
		desktop: { store: backend.store, files: backend.files, events: base.events },
		config: { delayMs: 0, startup }
	});
	return Object.assign(mounted, { emit: base.emit.bind(base) });
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function titleKey(mounted: MountedPlugin): unknown {
	return mounted.ctx.contextKeys.get('document.title');
}

describe('new and open', () => {
	it('new document flushes the old file first, replaces the document and attaches the new file', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'edited' }), user);

		expect(await fileSession.newDocument()).toBe(true);
		expect(backend.calls).toEqual(['commit:1', 'newUntitled']);
		expect(document.pages().map((entry) => entry.name)).toEqual(['Fresh']);
		expect(fileSession.info).toMatchObject({ untitled: true, name: 'Untitled' });
		expect(fileSession.dirty).toBe(false);
		await mounted.cleanup();
	});

	it('a cancelled new or open leaves everything as it was', async () => {
		const backend = new FakeBackend();
		backend.newUntitled = null;
		backend.opened = null;
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		expect(await fileSession.newDocument()).toBe(false);
		expect(await fileSession.openDocument('/docs/x.ndesign')).toBe(false);
		backend.openDialogResult = null;
		expect(await fileSession.openDocument()).toBe(false);
		expect(document.pages().map((entry) => entry.name)).toEqual(['A', 'B']);
		expect(fileSession.info).toMatchObject({ path: '/docs/a.ndesign' });
		await mounted.cleanup();
	});

	it('open persists the old file before main switches, then loads the new one', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'edited' }), user);

		expect(await fileSession.openDocument('/docs/opened.ndesign')).toBe(true);
		expect(backend.calls).toEqual(['commit:1', 'open:/docs/opened.ndesign']);
		expect(document.pages().map((entry) => entry.name)).toEqual(['Opened']);
		expect(titleKey(mounted)).toBe('opened');
		await mounted.cleanup();
	});

	it('open without a path asks the dialog', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await mounted.ctx.fileSession.openDocument();
		expect(backend.calls).toEqual(['openDialog', 'open:/docs/chosen.ndesign']);
		await mounted.cleanup();
	});

	it('a file that fails to open rejects and the window keeps its document and file', async () => {
		const backend = new FakeBackend();
		backend.openFailure = 'HANDLER_FAILED: /x is damaged';
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		await expect(fileSession.openDocument('/x')).rejects.toThrow('damaged');
		expect(document.pages().map((entry) => entry.name)).toEqual(['A', 'B']);
		expect(fileSession.info).toMatchObject({ path: '/docs/a.ndesign' });
		await mounted.cleanup();
	});
});

describe('dirty state and the context keys', () => {
	it('dirty follows commits and Save; keys mirror it for the title bar', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document, contextKeys } = mounted.ctx;
		expect(contextKeys.get('document.title')).toBe('Untitled');
		expect(contextKeys.get('document.dirty')).toBe(false);

		fileSession.attach(infoOf({ name: 'design' }));
		expect(fileSession.dirty).toBe(false);
		expect(contextKeys.get('document.title')).toBe('design');

		document.apply(document.setProps('n3', { name: 'x' }), user);
		expect(fileSession.dirty).toBe(true);
		expect(contextKeys.get('document.dirty')).toBe(true);

		backend.checkpointInfo = infoOf({ name: 'design' });
		expect(await fileSession.save()).toBe(true);
		expect(backend.calls).toEqual(['commit:1', 'checkpoint']);
		expect(fileSession.dirty).toBe(false);
		expect(contextKeys.get('document.dirty')).toBe(false);

		const transaction = document.apply(document.setProps('n3', { name: 'y' }), user);
		expect(contextKeys.get('document.dirty')).toBe(true);
		document.apply(transaction.undo, { ...user, replay: 'undo' });
		expect(fileSession.dirty).toBe(true);
		await mounted.cleanup();
	});

	it('a file opened with edits nobody saved (recovered) is dirty from the start', async () => {
		const mounted = await mount(new FakeBackend());
		mounted.ctx.fileSession.attach(infoOf({ unsaved: true, recovered: true }));
		expect(mounted.ctx.fileSession.dirty).toBe(true);
		expect(mounted.ctx.contextKeys.get('document.dirty')).toBe(true);
		await mounted.cleanup();
	});

	it('without a file there is nothing to be dirty', async () => {
		const mounted = await mount(new FakeBackend());
		mounted.ctx.document.apply(mounted.ctx.document.setProps('n3', { name: 'x' }), user);
		expect(mounted.ctx.fileSession.dirty).toBe(false);
		await mounted.cleanup();
	});

	it('edits made while a save is in flight keep the document dirty', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'x' }), user);
		const original = backend.store.checkpoint.bind(backend.store);
		backend.store.checkpoint = async () => {
			document.apply(document.setProps('n3', { name: 'during' }), user);
			return original();
		};
		await fileSession.save();
		expect(fileSession.dirty).toBe(true);
		await mounted.cleanup();
	});

	it('unmounting removes the keys it published', async () => {
		const mounted = await mount(new FakeBackend());
		expect(mounted.ctx.contextKeys.get('document.title')).toBe('Untitled');
		await mounted.fiber.dispose();
		await settle();
		expect(mounted.ctx.contextKeys.get('document.title')).toBeUndefined();
		await mounted.cleanup();
	});
});

describe('save and save as', () => {
	it('saving an untitled document asks where, using its name, then flushes and saves as', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf({ name: 'Untitled', untitled: true, path: '/u/untitled-1.ndesign' }));
		document.apply(document.setProps('n3', { name: 'x' }), user);

		expect(await fileSession.save()).toBe(true);
		expect(backend.suggestedNames).toEqual(['Untitled']);
		expect(backend.calls).toEqual(['saveDialog', 'commit:1', 'saveAs:/docs/saved.ndesign']);
		expect(fileSession.info).toMatchObject({
			path: '/docs/saved.ndesign',
			untitled: false,
			name: 'saved'
		});
		expect(fileSession.dirty).toBe(false);
		expect(titleKey(mounted)).toBe('saved');
		expect(mounted.ctx.contextKeys.get('document.untitled')).toBe(false);
		await mounted.cleanup();
	});

	it('cancelling the save dialog saves nothing', async () => {
		const backend = new FakeBackend();
		backend.saveDialogResult = null;
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf({ untitled: true }));
		document.apply(document.setProps('n3', { name: 'x' }), user);
		expect(await fileSession.save()).toBe(false);
		expect(backend.calls).toEqual(['saveDialog']);
		expect(fileSession.dirty).toBe(true);
		await mounted.cleanup();
	});

	it('save as with a path skips the dialog and renames the document to the new file', async () => {
		const backend = new FakeBackend();
		backend.saveAsName = 'copy';
		const mounted = await mount(backend);
		const { fileSession } = mounted.ctx;
		fileSession.attach(infoOf());
		expect(await fileSession.saveAs('/elsewhere/copy.ndesign')).toBe(true);
		expect(backend.calls).toEqual(['saveAs:/elsewhere/copy.ndesign']);
		expect(fileSession.displayName).toBe('copy');
		await mounted.cleanup();
	});

	it('saving needs an open file', async () => {
		const mounted = await mount(new FakeBackend());
		await expect(mounted.ctx.fileSession.save()).rejects.toThrow(/no document file/);
		await mounted.cleanup();
	});
});

describe('commands and shortcuts', () => {
	it('file.new, file.open (with and without a path), file.save and file.saveAs', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { commands, fileSession } = mounted.ctx;
		await commands.run('file.new');
		expect(fileSession.info).toMatchObject({ untitled: true });
		await commands.run('file.open', { path: '/docs/p.ndesign' });
		expect(fileSession.info).toMatchObject({ name: 'opened' });
		await commands.run('file.save');
		await commands.run('file.saveAs', { path: '/docs/s.ndesign' });
		expect(backend.calls).toEqual([
			'newUntitled',
			'open:/docs/p.ndesign',
			'checkpoint',
			'saveAs:/docs/s.ndesign'
		]);
		await mounted.cleanup();
	});

	it('Mod+N, Mod+O, Mod+S and Mod+Shift+S are bound, and work from a text field', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const bindings = mounted.ctx.keymap.registry
			.listAll()
			.map((binding) => `${binding.chord}>${binding.command}`);
		expect(bindings).toEqual(
			expect.arrayContaining([
				'ctrl+n>file.new',
				'ctrl+o>file.open',
				'ctrl+s>file.save',
				'ctrl+shift+s>file.saveAs'
			])
		);
		mounted.ctx.fileSession.attach(infoOf());
		const input = globalThis.document.createElement('input');
		const handled = mounted.ctx.keymap.handleKeydown({
			key: 's',
			code: 'KeyS',
			ctrlKey: true,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			repeat: false,
			target: input,
			preventDefault: () => undefined
		});
		expect(handled).toBe(true);
		await settle();
		expect(backend.calls).toContain('checkpoint');
		await mounted.cleanup();
	});
});

describe('startup', () => {
	it('opens the file the launch named', async () => {
		const backend = new FakeBackend();
		backend.launch = '/docs/launch.ndesign';
		const mounted = await mount(backend, 'auto');
		await settle();
		expect(backend.calls).toEqual(['launchRequest', 'open:/docs/launch.ndesign']);
		expect(mounted.ctx.fileSession.info).toMatchObject({ name: 'opened' });
		await mounted.cleanup();
	});

	it('restores what a crash left, when the user agrees', async () => {
		const backend = new FakeBackend();
		backend.recovery = loadedPage('Recovered', { name: 'Untitled', untitled: true, unsaved: true });
		const mounted = await mount(backend, 'auto');
		await settle();
		expect(backend.calls).toEqual(['launchRequest', 'offerRecovery']);
		expect(mounted.ctx.document.pages().map((entry) => entry.name)).toEqual(['Recovered']);
		expect(mounted.ctx.fileSession.dirty).toBe(true);
		await mounted.cleanup();
	});

	it('otherwise starts a new untitled document', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend, 'auto');
		await settle();
		expect(backend.calls).toEqual(['launchRequest', 'offerRecovery', 'newUntitled']);
		expect(mounted.ctx.fileSession.info).toMatchObject({ untitled: true });
		await mounted.cleanup();
	});

	it('does nothing when configured not to', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend, 'none');
		await settle();
		expect(backend.calls).toEqual([]);
		await mounted.cleanup();
	});
});

describe('main talking to the renderer', () => {
	it('a flush request persists the queue, then confirms with its id', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'x' }), user);
		mounted.emit('files:flush-request', { requestId: 'r1' });
		await settle();
		expect(backend.calls).toEqual(['commit:1', 'flushed:r1']);
		await mounted.cleanup();
	});

	it('an open request from the OS opens that file', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		mounted.emit('files:open-request', { path: '/docs/finder.ndesign' });
		await settle();
		expect(backend.calls).toEqual(['open:/docs/finder.ndesign']);
		await mounted.cleanup();
	});

	it('dropping a design file on the window opens it; other files are ignored', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const drop = (names: string[]): Event => {
			const event = new Event('drop', { cancelable: true });
			Object.defineProperty(event, 'dataTransfer', {
				value: { types: ['Files'], files: names.map((name) => ({ name })) }
			});
			return event;
		};
		window.dispatchEvent(drop(['notes.txt']));
		await settle();
		expect(backend.calls).toEqual([]);
		const event = drop(['notes.txt', 'design.ndesign']);
		window.dispatchEvent(event);
		await settle();
		expect(event.defaultPrevented).toBe(true);
		expect(backend.calls).toEqual(['open:/dropped/design.ndesign']);
		await mounted.cleanup();
	});
});
