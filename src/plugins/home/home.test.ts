import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type {
	DesktopBridge,
	LibraryFile,
	LibraryFolder,
	LibraryOverview,
	LinkedFolder
} from '../../../electron/bridge';
import { createBrowserBridge } from '../../lib/desktop/browserBridge';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import home from './index';

const ROOT = '/lib';

function file(
	name: string,
	folder: string,
	times: { modifiedAt: number; openedAt: number | null } = { modifiedAt: 1, openedAt: null }
): LibraryFile {
	const directory = folder === '' ? ROOT : `${ROOT}/${folder}`;
	return {
		path: `${directory}/${name}.ndesign`,
		name,
		...times,
		location: { kind: 'library', folder },
		thumbnail: null
	};
}

/** An in-memory library behind the bridge, recording every call that changes it. */
class FakeLibrary {
	readonly calls: string[] = [];
	files: LibraryFile[] = [];
	folders: LibraryFolder[] = [];
	linked: LinkedFolder[] = [];
	recent: LibraryFile[] = [];
	listFailures = new Set<string>();
	linkResult: LinkedFolder | null = null;

	private folderOf(file: LibraryFile): string {
		return file.path.slice(0, file.path.lastIndexOf('/'));
	}

	overview(): LibraryOverview {
		return {
			root: ROOT,
			folders: this.folders.map((folder) => ({
				...folder,
				fileCount: this.files.filter((entry) => this.folderOf(entry) === folder.path).length
			})),
			linked: this.linked
		};
	}

	bridge(): Partial<DesktopBridge> {
		const base = createBrowserBridge();
		const files: DesktopBridge['files'] = {
			...base.files,
			recent: () => Promise.resolve(this.recent),
			removeRecent: (path) => {
				this.calls.push(`removeRecent:${path}`);
				this.recent = this.recent.filter((entry) => entry.path !== path);
				return Promise.resolve();
			},
			reveal: (path) => {
				this.calls.push(`reveal:${path}`);
				return Promise.resolve();
			}
		};
		const library: DesktopBridge['library'] = {
			overview: () => Promise.resolve(this.overview()),
			list: (directory) => {
				if (this.listFailures.has(directory)) return Promise.reject(new Error('gone'));
				return Promise.resolve({
					directory,
					folders: [],
					files: this.files.filter((entry) => this.folderOf(entry) === directory)
				});
			},
			search: (query) => {
				this.calls.push(`search:${query}`);
				const needle = query.toLowerCase();
				return Promise.resolve(
					this.files.filter((entry) => entry.name.toLowerCase().includes(needle))
				);
			},
			createFolder: (parent, name) => {
				this.calls.push(`createFolder:${parent}:${name}`);
				const folder = { path: `${parent}/${name}`, name, fileCount: 0, modifiedAt: 1 };
				this.folders.push(folder);
				return Promise.resolve(folder);
			},
			renameFolder: (path, name) => {
				this.calls.push(`renameFolder:${path}:${name}`);
				const folder = { path: `${ROOT}/${name}`, name, fileCount: 0, modifiedAt: 1 };
				this.folders = this.folders.map((entry) => (entry.path === path ? folder : entry));
				return Promise.resolve(folder);
			},
			trashFolder: (path) => {
				this.calls.push(`trashFolder:${path}`);
				this.folders = this.folders.filter((entry) => entry.path !== path);
				return Promise.resolve();
			},
			renameFile: (path, name) => {
				this.calls.push(`renameFile:${path}:${name}`);
				return Promise.resolve(file(name, ''));
			},
			moveFile: (path, directory) => {
				this.calls.push(`moveFile:${path}:${directory}`);
				const moved = this.files.find((entry) => entry.path === path);
				if (moved === undefined) return Promise.reject(new Error('missing'));
				const next = { ...moved, path: `${directory}/${moved.name}.ndesign` };
				this.files = this.files.map((entry) => (entry.path === path ? next : entry));
				return Promise.resolve(next);
			},
			duplicateFile: (path) => {
				this.calls.push(`duplicateFile:${path}`);
				return Promise.resolve(file('copy', ''));
			},
			trashFile: (path) => {
				this.calls.push(`trashFile:${path}`);
				this.files = this.files.filter((entry) => entry.path !== path);
				return Promise.resolve();
			},
			linkFolder: () => {
				this.calls.push('linkFolder');
				if (this.linkResult !== null) this.linked.push(this.linkResult);
				return Promise.resolve(this.linkResult);
			},
			unlinkFolder: (id) => {
				this.calls.push(`unlinkFolder:${id}`);
				this.linked = this.linked.filter((entry) => entry.id !== id);
				return Promise.resolve();
			}
		};
		return { files, library, events: base.events };
	}
}

const toasts: string[] = [];

const errorUiStub: Plugin = {
	name: 'error-ui-stub',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('errorUi', {
			toast: (message: string) => void toasts.push(message)
		})
} as Plugin;

const providers = [
	coreRegions,
	coreContextKeys,
	coreKeymap,
	coreCommands,
	coreMenus,
	desktopBridge,
	errorUiStub
];

async function mountHome(library: FakeLibrary): Promise<MountedPlugin> {
	toasts.length = 0;
	const mounted = await mountPlugin(home, { providers, desktop: library.bridge() });
	await mounted.ctx.home.refresh();
	return mounted;
}

function firstFolder(ctx: Context): LibraryFolder {
	const folder = ctx.home.overview?.folders[0];
	if (folder === undefined) throw new Error('no folder');
	return folder;
}

function firstLinked(ctx: Context): LinkedFolder {
	const linked = ctx.home.overview?.linked[0];
	if (linked === undefined) throw new Error('no linked folder');
	return linked;
}

function names(files: LibraryFile[]): string[] {
	return files.map((entry) => entry.name);
}

describePlugin('home', home, {
	providers,
	desktop: new FakeLibrary().bridge(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('home.show')).toBe(true);
		expect(ctx.commands.has('home.file.rename')).toBe(true);
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain('home/screen');
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toContain('home/button');
		expect(ctx.menus.has('context/home-file')).toBe(true);
		expect(ctx.menus.has('context/home-folder')).toBe(true);
		expect(ctx.menus.has('context/home-linked')).toBe(true);
		expect(ctx.home.visible).toBe(false);
	}
});

describe('visibility and sections', () => {
	it('is visible when the document was closed or when asked, and hides when a file attaches', async () => {
		const mounted = await mountHome(new FakeLibrary());
		const { ctx } = mounted;
		expect(ctx.home.visible).toBe(false);
		const unset = ctx.contextKeys.set('document.closed', true);
		expect(ctx.home.visible).toBe(true);
		unset();
		expect(ctx.home.visible).toBe(false);

		await ctx.commands.run('home.show');
		expect(ctx.home.visible).toBe(true);
		ctx.emit('file/attached', {} as never);
		expect(ctx.home.visible).toBe(false);
		await mounted.cleanup();
	});

	it('starts on Recents, switches to Drafts (the library root) and to a folder', async () => {
		const library = new FakeLibrary();
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		library.files = [file('draft', ''), file('poster', 'Work')];
		library.recent = [file('draft', '', { modifiedAt: 1, openedAt: 9 })];
		const { ctx } = await mountHome(library);
		expect(ctx.home.location).toEqual({ kind: 'recents' });
		expect(names(ctx.home.files())).toEqual(['draft']);

		await ctx.home.showDirectory(ROOT);
		expect(names(ctx.home.files())).toEqual(['draft']);
		await ctx.home.showDirectory('/lib/Work');
		expect(names(ctx.home.files())).toEqual(['poster']);
		expect(ctx.home.breadcrumbs.map((crumb) => crumb.label)).toEqual(['Work']);
		expect(ctx.home.overview?.folders[0].fileCount).toBe(1);
	});

	it('falls back to Drafts when the shown directory vanished', async () => {
		const library = new FakeLibrary();
		library.files = [file('draft', '')];
		const { ctx } = await mountHome(library);
		library.listFailures.add('/lib/Gone');
		await ctx.home.showDirectory('/lib/Gone');
		expect(ctx.home.location).toEqual({ kind: 'directory', path: ROOT });
		expect(names(ctx.home.files())).toEqual(['draft']);
		expect(toasts).toEqual([]);
	});
});

describe('sorting, view and search', () => {
	it('sorts the files and remembers the view', async () => {
		const library = new FakeLibrary();
		library.files = [
			file('beta', '', { modifiedAt: 20, openedAt: 1 }),
			file('Alpha', '', { modifiedAt: 10, openedAt: 5 })
		];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory(ROOT);
		ctx.home.setSort('edited');
		expect(names(ctx.home.files())).toEqual(['beta', 'Alpha']);
		ctx.home.setSort('opened');
		expect(names(ctx.home.files())).toEqual(['Alpha', 'beta']);
		ctx.home.setSort('name');
		expect(names(ctx.home.files())).toEqual(['Alpha', 'beta']);
		ctx.home.setView('list');
		expect(ctx.home.view).toBe('list');
	});

	it('search results replace the files while the query is not empty', async () => {
		const library = new FakeLibrary();
		library.files = [file('Poster', ''), file('Logo', 'Work')];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory(ROOT);
		await ctx.home.setQuery('log');
		expect(library.calls).toContain('search:log');
		expect(ctx.home.searching).toBe(true);
		expect(names(ctx.home.files())).toEqual(['Logo']);
		await ctx.home.setQuery('zzz');
		expect(ctx.home.files()).toEqual([]);
		await ctx.home.setQuery('  ');
		expect(ctx.home.searching).toBe(false);
		expect(names(ctx.home.files())).toEqual(['Poster']);
	});
});

describe('file actions', () => {
	it('open and new go through the file commands; new creates in the shown folder', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', 'Work')];
		const mounted = await mountHome(library);
		const { ctx } = mounted;
		const opened: unknown[] = [];
		const created: unknown[] = [];
		ctx.commands.register({
			id: 'file.open',
			title: 'Open',
			run: (args) => void opened.push(args)
		});
		ctx.commands.register({
			id: 'file.new',
			title: 'New',
			run: (args) => void created.push(args)
		});
		await ctx.commands.run('home.show');
		await ctx.home.showDirectory('/lib/Work');
		await ctx.home.open(ctx.home.files()[0]);
		expect(opened).toEqual([{ path: '/lib/Work/a.ndesign' }]);
		expect(ctx.home.visible).toBe(false);

		await ctx.commands.run('home.show');
		await ctx.home.newFile();
		expect(created).toEqual([{ directory: '/lib/Work' }]);
		await ctx.home.showRecents();
		await ctx.commands.run('home.show');
		await ctx.home.newFile();
		expect(created[1]).toEqual({ directory: undefined });
		await mounted.cleanup();
	});

	it('publishes the shown directory so File > New can use it, and clears it on unmount', async () => {
		const library = new FakeLibrary();
		const mounted = await mountHome(library);
		const { ctx } = mounted;
		await ctx.commands.run('home.show');
		await ctx.home.showDirectory('/lib/Work');
		flushSync();
		expect(ctx.contextKeys.get('home.directory')).toBe('/lib/Work');
		expect(ctx.contextKeys.get('home.recents')).toBe(false);
		ctx.home.hide();
		flushSync();
		expect(ctx.contextKeys.get('home.directory')).toBe('');
		await mounted.fiber.dispose();
		expect(ctx.contextKeys.get('home.directory')).toBeUndefined();
		await mounted.cleanup();
	});

	it('renames, duplicates, moves and reveals through the library, then reloads', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory(ROOT);
		const [first] = ctx.home.files();

		ctx.home.beginRename(first.path);
		expect(ctx.home.renamingPath).toBe(first.path);
		await ctx.home.renameFile(first, '  Poster ');
		expect(ctx.home.renamingPath).toBeNull();
		await ctx.home.renameFile(first, 'a');
		await ctx.home.renameFile(first, '   ');
		await ctx.home.duplicateFile(first);
		await ctx.home.moveFile(first.path, '/lib/Work');
		await ctx.home.moveFile('/lib/Work/a.ndesign', '/lib/Work');
		await ctx.home.reveal(first.path);
		expect(library.calls).toEqual([
			'renameFile:/lib/a.ndesign:Poster',
			'duplicateFile:/lib/a.ndesign',
			'moveFile:/lib/a.ndesign:/lib/Work',
			'reveal:/lib/a.ndesign'
		]);
		expect(ctx.home.overview?.folders[0].fileCount).toBe(1);
	});

	it('removes a recent file from the list only', async () => {
		const library = new FakeLibrary();
		library.recent = [file('a', '', { modifiedAt: 1, openedAt: 2 }), file('b', '')];
		const { ctx } = await mountHome(library);
		await ctx.home.removeRecent(ctx.home.files()[0]);
		expect(library.calls).toEqual(['removeRecent:/lib/a.ndesign']);
		expect(ctx.home.files()).toHaveLength(1);
	});

	it('asks before trashing a file, and trashes only after confirming', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory(ROOT);
		ctx.home.requestTrashFile(ctx.home.files()[0]);
		expect(ctx.home.pendingTrash).toEqual({ kind: 'file', path: '/lib/a.ndesign', name: 'a' });
		ctx.home.cancelTrash();
		await ctx.home.confirmTrash();
		expect(library.calls).toEqual([]);

		ctx.home.requestTrashFile(ctx.home.files()[0]);
		await ctx.home.confirmTrash();
		expect(library.calls).toEqual(['trashFile:/lib/a.ndesign']);
		expect(ctx.home.files()).toEqual([]);
		expect(ctx.home.pendingTrash).toBeNull();
	});
});

describe('folders and linked folders', () => {
	it('creates a folder under the library root and lists it', async () => {
		const library = new FakeLibrary();
		const { ctx } = await mountHome(library);
		ctx.home.beginCreateFolder();
		expect(ctx.home.creatingFolder).toBe(true);
		await ctx.home.createFolder(' Work ');
		expect(ctx.home.creatingFolder).toBe(false);
		expect(library.calls).toEqual(['createFolder:/lib:Work']);
		expect(ctx.home.overview?.folders.map((folder) => folder.name)).toEqual(['Work']);

		ctx.home.beginCreateFolder();
		await ctx.home.createFolder('   ');
		expect(library.calls).toHaveLength(1);
	});

	it('renames a folder and follows it when it is the one shown; trashing it leaves it', async () => {
		const library = new FakeLibrary();
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory('/lib/Work');
		await ctx.home.renameFolder(firstFolder(ctx), 'Clients');
		expect(ctx.home.location).toEqual({ kind: 'directory', path: '/lib/Clients' });

		ctx.home.requestTrashFolder(firstFolder(ctx));
		await ctx.home.confirmTrash();
		expect(library.calls).toEqual(['renameFolder:/lib/Work:Clients', 'trashFolder:/lib/Clients']);
		expect(ctx.home.location).toEqual({ kind: 'recents' });
	});

	it('links a folder, shows it, and unlinks it again', async () => {
		const library = new FakeLibrary();
		library.linkResult = { id: 'l1', name: 'repo', path: '/home/me/repo', available: true };
		const { ctx } = await mountHome(library);
		await ctx.home.linkFolder();
		expect(ctx.home.overview?.linked.map((linked) => linked.name)).toEqual(['repo']);
		expect(ctx.home.location).toEqual({ kind: 'directory', path: '/home/me/repo' });
		expect(ctx.home.inLinkedFolder).toBe(true);

		await ctx.home.unlinkFolder(firstLinked(ctx));
		expect(library.calls).toEqual(['linkFolder', 'unlinkFolder:l1']);
		expect(ctx.home.overview?.linked).toEqual([]);
		expect(ctx.home.location).toEqual({ kind: 'recents' });
	});

	it('a cancelled link dialog changes nothing', async () => {
		const library = new FakeLibrary();
		const { ctx } = await mountHome(library);
		await ctx.home.linkFolder();
		expect(ctx.home.location).toEqual({ kind: 'recents' });
	});
});

describe('errors and file moves', () => {
	it('reports a failed action as a toast and leaves the screen as it was', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		const { ctx } = await mountHome(library);
		await ctx.home.showDirectory(ROOT);
		await ctx.home.moveFile('/lib/missing.ndesign', '/lib/Work');
		expect(toasts).toEqual(['Could not move the file: missing']);
		expect(names(ctx.home.files())).toEqual(['a']);
	});

	it('reloads when a file was renamed, moved or trashed (file/moved)', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		const mounted = await mountHome(library);
		await mounted.ctx.home.showDirectory(ROOT);
		library.files = [file('b', '')];
		mounted.ctx.emit('file/moved', { from: '/lib/a.ndesign', to: '/lib/b.ndesign' });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(names(mounted.ctx.home.files())).toEqual(['b']);
		await mounted.cleanup();
	});
});

describe('context menus', () => {
	it('lists the file actions, the move destinations, and remove from recents only in Recents', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		library.recent = [file('a', '', { modifiedAt: 1, openedAt: 2 })];
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		library.linked = [{ id: 'l1', name: 'repo', path: '/home/me/repo', available: true }];
		const mounted = await mountHome(library);
		const { ctx } = mounted;
		const titles = (): string[] => ctx.menus.resolve('context/home-file').map((item) => item.title);

		expect(titles()).toEqual([
			'Open',
			'Rename',
			'Duplicate',
			'Move to',
			'Show in folder',
			'Remove from recents',
			'Move to trash'
		]);
		const moveTo = ctx.menus.resolve('context/home-file').find((item) => item.title === 'Move to');
		expect(moveTo?.submenu?.map((item) => item.title)).toEqual(['Drafts', 'Work', 'repo']);

		await ctx.home.showDirectory(ROOT);
		flushSync();
		expect(titles()).not.toContain('Remove from recents');
		expect(ctx.menus.resolve('context/home-folder').map((item) => item.title)).toEqual([
			'Rename',
			'Show in folder',
			'Move to trash'
		]);
		expect(ctx.menus.resolve('context/home-linked').map((item) => item.title)).toEqual([
			'Show in folder',
			'Unlink folder'
		]);
		await mounted.cleanup();
	});

	it('the Move to items move the file the menu was opened for', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		const mounted = await mountHome(library);
		const { ctx } = mounted;
		await ctx.home.showDirectory(ROOT);
		ctx.home.openFileMenu(new MouseEvent('contextmenu'), ctx.home.files()[0]);
		expect(ctx.menus.popup?.kind).toBe('home-file');
		const moveTo = ctx.menus.resolve('context/home-file').find((item) => item.title === 'Move to');
		const work = moveTo?.submenu?.find((item) => item.title === 'Work');
		if (work === undefined) throw new Error('no Work destination');
		await ctx.menus.activate(work);
		expect(library.calls).toEqual(['moveFile:/lib/a.ndesign:/lib/Work']);
		await mounted.cleanup();
	});

	it('rename from the menu starts an inline rename; trash from the menu asks first', async () => {
		const library = new FakeLibrary();
		library.files = [file('a', '')];
		const mounted = await mountHome(library);
		const { ctx } = mounted;
		await ctx.home.showDirectory(ROOT);
		await ctx.commands.run('home.file.rename', { path: '/lib/a.ndesign' });
		expect(ctx.home.renamingPath).toBe('/lib/a.ndesign');
		await ctx.commands.run('home.file.trash', { path: '/lib/a.ndesign' });
		expect(ctx.home.pendingTrash?.name).toBe('a');
		expect(library.calls).toEqual([]);
		await mounted.cleanup();
	});
});

describe('the screen', () => {
	let target: HTMLElement | undefined;
	let host: ReturnType<typeof mount> | undefined;

	afterEach(async () => {
		if (host) await unmount(host);
		target?.remove();
		host = undefined;
		target = undefined;
	});

	async function render(library: FakeLibrary): Promise<MountedPlugin> {
		const mounted = await mountHome(library);
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'overlay' } });
		await mounted.ctx.commands.run('home.show');
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		return mounted;
	}

	it('shows the sidebar with the Draftboard wordmark, folders and linked folders', async () => {
		const library = new FakeLibrary();
		library.folders = [{ path: '/lib/Work', name: 'Work', fileCount: 0, modifiedAt: 1 }];
		library.linked = [
			{ id: 'l1', name: 'repo', path: '/home/me/repo', available: true },
			{ id: 'l2', name: 'usb', path: '/mnt/usb', available: false }
		];
		const mounted = await render(library);
		expect(target?.querySelector('[data-home-wordmark]')?.textContent?.trim()).toBe('Draftboard');
		expect(target?.querySelector('[data-home-nav="recents"]')).not.toBeNull();
		expect(target?.querySelector('[data-home-nav="drafts"]')).not.toBeNull();
		expect(target?.querySelector('[data-home-nav-folder="/lib/Work"]')?.textContent).toContain(
			'Work'
		);
		const unavailable = target?.querySelector('[data-home-nav-linked="l2"]');
		expect(unavailable?.classList.contains('opacity-50')).toBe(true);
		expect(unavailable?.textContent).toContain('Folder not found');
		await mounted.cleanup();
	});

	it('shows the empty state of Drafts with a New design file button', async () => {
		const mounted = await render(new FakeLibrary());
		target?.querySelector<HTMLElement>('[data-home-nav="drafts"]')?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		const empty = target?.querySelector('[data-home-empty]');
		expect(empty?.textContent).toContain('No files yet');
		expect(empty?.textContent).toContain('New design file');
		await mounted.cleanup();
	});

	it('lists file cards with their edited time; double click on the name renames inline', async () => {
		const library = new FakeLibrary();
		library.files = [
			file('Poster', '', { modifiedAt: Date.now() - 3 * 86_400_000, openedAt: null })
		];
		const mounted = await render(library);
		target?.querySelector<HTMLElement>('[data-home-nav="drafts"]')?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		const card = target?.querySelector('[data-home-entry="/lib/Poster.ndesign"]');
		expect(card?.textContent).toContain('Poster');
		expect(card?.textContent).toContain('Edited 3 days ago');

		card
			?.querySelector('[data-home-name]')
			?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		const input = card?.querySelector<HTMLInputElement>('[data-inline-rename]');
		expect(input).not.toBeNull();
		if (!input) return;
		input.value = 'Banner';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(library.calls).toEqual(['renameFile:/lib/Poster.ndesign:Banner']);
		await mounted.cleanup();
	});

	it('asks for confirmation in a dialog before trashing', async () => {
		const library = new FakeLibrary();
		library.files = [file('Poster', '')];
		const mounted = await render(library);
		await mounted.ctx.home.showDirectory(ROOT);
		mounted.ctx.home.requestTrashFile(mounted.ctx.home.files()[0]);
		flushSync();
		const dialog = target?.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain('Move "Poster" to the trash?');
		await mounted.cleanup();
	});
});
