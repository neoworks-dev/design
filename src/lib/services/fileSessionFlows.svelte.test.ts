import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import type {
	CommitResult,
	DesktopBridge,
	LibraryFile,
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
		inLibrary: true,
		...overrides
	};
}

function loadedPage(name: string, info: Partial<StoreInfo> = {}): LoadedDocument {
	const document = buildDocument([page(name)]);
	document.id = `doc-${name}`;
	return { info: infoOf({ documentId: document.id, ...info }), document };
}

function libraryFile(path: string, name: string): LibraryFile {
	return {
		path,
		name,
		modifiedAt: 0,
		openedAt: null,
		location: { kind: 'library', folder: '' },
		thumbnail: null
	};
}

/** A scriptable `files`, `library` and `store` bridge that records the order of calls. */
class FakeBackend {
	readonly calls: string[] = [];
	fresh: LoadedDocument = loadedPage('Fresh', { name: 'Untitled', path: '/lib/Untitled.ndesign' });
	opened: LoadedDocument = loadedPage('Opened', { name: 'opened' });
	openFailure: string | null = null;
	launch: string | null = null;
	openDialogResult: string | null = '/docs/chosen.ndesign';
	saveDialogResult: string | null = '/docs/saved.ndesign';
	suggestedNames: string[] = [];
	saveAsName = 'saved';

	store: DesktopBridge['store'] = {
		open: () => Promise.reject(new Error('not used')),
		create: () => Promise.reject(new Error('not used')),
		load: () => Promise.reject(new Error('not used')),
		close: () => {
			this.calls.push('storeClose');
			return Promise.resolve();
		},
		commit: (transactions): Promise<CommitResult> => {
			this.calls.push(`commit:${transactions.length}`);
			return Promise.resolve({ committed: transactions.length, documentRows: 0 });
		},
		checkpoint: () => {
			this.calls.push('checkpoint');
			return Promise.resolve(infoOf());
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

	library: DesktopBridge['library'] = {
		...createBrowserBridge().library,
		renameFile: (path, name) => {
			this.calls.push(`rename:${path}:${name}`);
			return Promise.resolve(libraryFile(`/docs/${name}.ndesign`, name));
		}
	};

	files: DesktopBridge['files'] = {
		recent: () => Promise.resolve([]),
		removeRecent: () => Promise.resolve(),
		reveal: () => Promise.resolve(),
		clearRecent: () => Promise.resolve(),
		setThumbnail: () => Promise.resolve(),
		new: (directory) => {
			this.calls.push(`new:${directory ?? ''}`);
			return Promise.resolve(this.fresh);
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
			return Promise.resolve(infoOf({ path, name: this.saveAsName }));
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
		desktop: {
			store: backend.store,
			files: backend.files,
			library: backend.library,
			events: base.events
		},
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
	it('new document flushes the old file first, then creates the file in the folder and attaches it', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'edited' }), user);

		expect(await fileSession.newDocument('/lib/Work')).toBe(true);
		expect(backend.calls).toEqual(['commit:1', 'new:/lib/Work']);
		expect(document.pages().map((entry) => entry.name)).toEqual(['Fresh']);
		expect(fileSession.info).toMatchObject({ name: 'Untitled', inLibrary: true });
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

	it('open without a path asks the dialog; a cancelled dialog changes nothing', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await mounted.ctx.fileSession.openDocument();
		expect(backend.calls).toEqual(['openDialog', 'open:/docs/chosen.ndesign']);
		backend.calls.length = 0;
		backend.openDialogResult = null;
		expect(await mounted.ctx.fileSession.openDocument()).toBe(false);
		expect(backend.calls).toEqual(['openDialog']);
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

describe('the context keys', () => {
	it('mirror the file name and whether autosave has work; there is no dirty key', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document, contextKeys } = mounted.ctx;
		expect(contextKeys.get('document.title')).toBe('Untitled');
		expect(contextKeys.get('document.renamable')).toBe(false);

		fileSession.attach(infoOf({ name: 'design' }));
		expect(contextKeys.get('document.title')).toBe('design');
		expect(contextKeys.get('document.renamable')).toBe(true);
		expect(contextKeys.get('document.saving')).toBe(false);
		expect(contextKeys.get('document.dirty')).toBeUndefined();

		document.apply(document.setProps('n3', { name: 'x' }), user);
		await settle();
		expect(contextKeys.get('document.saving')).toBe(false);
		expect(backend.calls).toEqual(['commit:1']);
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

describe('autosave', () => {
	it('persists every committed change without anyone asking, then announces it is idle', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		let saved = 0;
		mounted.ctx.on('file/saved', () => {
			saved += 1;
		});
		document.apply(document.setProps('n3', { name: 'one' }), user);
		await settle();
		document.apply(document.setProps('n3', { name: 'two' }), user);
		await settle();
		expect(backend.calls).toEqual(['commit:1', 'commit:1']);
		expect(saved).toBe(2);
		await mounted.cleanup();
	});
});

describe('save, rename and save a copy', () => {
	it('save only flushes the queue: no dialog, no checkpoint', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'x' }), user);
		await fileSession.save();
		expect(backend.calls).toEqual(['commit:1']);
		await mounted.cleanup();
	});

	it('save with no file open does nothing', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		await mounted.ctx.fileSession.save();
		expect(backend.calls).toEqual([]);
		await mounted.cleanup();
	});

	it('save a copy asks where, using the file name, flushes, then continues in the copy', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf({ name: 'design' }));
		document.apply(document.setProps('n3', { name: 'x' }), user);

		expect(await fileSession.saveAs()).toBe(true);
		expect(backend.suggestedNames).toEqual(['design']);
		expect(backend.calls).toEqual(['saveDialog', 'commit:1', 'saveAs:/docs/saved.ndesign']);
		expect(fileSession.info).toMatchObject({ path: '/docs/saved.ndesign', name: 'saved' });
		expect(titleKey(mounted)).toBe('saved');
		await mounted.cleanup();
	});

	it('cancelling the save a copy dialog saves nothing', async () => {
		const backend = new FakeBackend();
		backend.saveDialogResult = null;
		const mounted = await mount(backend);
		mounted.ctx.fileSession.attach(infoOf());
		expect(await mounted.ctx.fileSession.saveAs()).toBe(false);
		expect(backend.calls).toEqual(['saveDialog']);
		await mounted.cleanup();
	});

	it('save a copy with a path skips the dialog', async () => {
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

	it('rename flushes, renames through the library and follows the new path', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'x' }), user);
		const moves: unknown[] = [];
		mounted.ctx.on('file/moved', (message) => {
			moves.push(message);
		});

		await fileSession.rename('Checkout');
		expect(backend.calls).toEqual(['commit:1', 'rename:/docs/a.ndesign:Checkout']);
		expect(fileSession.info).toMatchObject({ path: '/docs/Checkout.ndesign', name: 'Checkout' });
		expect(titleKey(mounted)).toBe('Checkout');
		expect(moves).toEqual([{ from: '/docs/a.ndesign', to: '/docs/Checkout.ndesign' }]);
		await mounted.cleanup();
	});
});

describe('files that move', () => {
	it('files:moved renames the attached file and tells tabs and home', async () => {
		const mounted = await mount(new FakeBackend());
		mounted.ctx.fileSession.attach(infoOf());
		const moves: unknown[] = [];
		mounted.ctx.on('file/moved', (message) => {
			moves.push(message);
		});
		mounted.emit('files:moved', { from: '/docs/a.ndesign', to: '/lib/Work/b.ndesign' });
		expect(mounted.ctx.fileSession.info).toMatchObject({ path: '/lib/Work/b.ndesign', name: 'b' });
		expect(moves).toHaveLength(1);
		mounted.emit('files:moved', { from: '/other.ndesign', to: null });
		expect(mounted.ctx.fileSession.info).toMatchObject({ path: '/lib/Work/b.ndesign' });
		expect(moves).toHaveLength(2);
		await mounted.cleanup();
	});

	it('a trashed attached file is released without writing to it', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { fileSession, document, contextKeys } = mounted.ctx;
		fileSession.attach(infoOf());
		document.apply(document.setProps('n3', { name: 'x' }), user);
		mounted.emit('files:moved', { from: '/docs/a.ndesign', to: null });
		await settle();
		expect(fileSession.info).toBeNull();
		expect(contextKeys.get('document.closed')).toBe(true);
		expect(backend.calls).toEqual([]);
		await mounted.cleanup();
	});
});

describe('commands and shortcuts', () => {
	it('file.new, file.open, file.save, file.saveAs and file.rename', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const { commands, fileSession } = mounted.ctx;
		await commands.run('file.new', { directory: '/lib/Work' });
		expect(fileSession.info).toMatchObject({ name: 'Untitled' });
		await commands.run('file.open', { path: '/docs/p.ndesign' });
		expect(fileSession.info).toMatchObject({ name: 'opened' });
		await commands.run('file.save');
		await commands.run('file.saveAs', { path: '/docs/s.ndesign' });
		await commands.run('file.rename', { name: 'Final' });
		expect(backend.calls).toEqual([
			'new:/lib/Work',
			'open:/docs/p.ndesign',
			'saveAs:/docs/s.ndesign',
			'rename:/docs/s.ndesign:Final'
		]);
		expect(commands.get('file.saveAs')?.title).toBe('Save a copy as...');
		await mounted.cleanup();
	});

	it('file.new uses the folder the home screen shows, when it publishes one', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend);
		const unset = mounted.ctx.contextKeys.set('home.directory', '/lib/Shown');
		await mounted.ctx.commands.run('file.new');
		unset();
		await mounted.ctx.commands.run('file.new');
		expect(backend.calls).toEqual(['new:/lib/Shown', 'new:']);
		await mounted.cleanup();
	});

	it('Mod+N, Mod+O, Mod+S and Mod+Shift+S are bound, and Mod+S works from a text field', async () => {
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
		mounted.ctx.document.apply(mounted.ctx.document.setProps('n3', { name: 'x' }), user);
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
		expect(backend.calls).toEqual(['commit:1']);
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

	it('opens nothing without a launch file: no recovery offer, no new document', async () => {
		const backend = new FakeBackend();
		const mounted = await mount(backend, 'auto');
		await settle();
		expect(backend.calls).toEqual(['launchRequest']);
		expect(mounted.ctx.fileSession.info).toBeNull();
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
