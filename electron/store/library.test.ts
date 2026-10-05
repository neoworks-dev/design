import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	LibraryError,
	libraryRootFor,
	readDirectory,
	uniqueName,
	validateFileName,
	validateName
} from './library';
import { LinkedFoldersStore } from './linkedFolders';
import { RecentFilesStore } from './recentFiles';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'library-helpers-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

describe('library root', () => {
	const base = { platform: 'linux' as const, documentsPath: '/docs', homePath: '/home/u' };

	it('uses XDG_DATA_HOME on Linux and falls back to ~/.local/share', () => {
		expect(libraryRootFor({ ...base, env: { XDG_DATA_HOME: '/data' } })).toBe('/data/draftboard');
		expect(libraryRootFor({ ...base, env: {} })).toBe('/home/u/.local/share/draftboard');
		expect(libraryRootFor({ ...base, env: { XDG_DATA_HOME: 'relative' } })).toBe(
			'/home/u/.local/share/draftboard'
		);
	});

	it('uses Documents/Draftboard on macOS and Windows', () => {
		expect(libraryRootFor({ ...base, platform: 'darwin', env: {} })).toBe('/docs/Draftboard');
		expect(libraryRootFor({ ...base, platform: 'win32', env: {} })).toBe('/docs/Draftboard');
	});

	it('lets DRAFTBOARD_LIBRARY_DIR override everything', () => {
		expect(libraryRootFor({ ...base, env: { DRAFTBOARD_LIBRARY_DIR: '/tmp/lib' } })).toBe(
			'/tmp/lib'
		);
	});
});

describe('names', () => {
	it('trims and accepts ordinary names', () => {
		expect(validateName('  My file ')).toBe('My file');
		expect(validateFileName('Logo.ndesign')).toBe('Logo');
	});

	it.each(['', '   ', 'a/b', 'a\\b', '..', 'a..b', '.', 'x'.repeat(201), 'nul\0'])(
		'rejects %j',
		(name) => {
			expect(() => validateName(name)).toThrow(LibraryError);
		}
	);

	it('numbers a taken name', () => {
		writeFileSync(path.join(directory, 'Untitled.ndesign'), '');
		writeFileSync(path.join(directory, 'Untitled 2.ndesign'), '');
		expect(uniqueName(directory, 'Untitled', '.ndesign')).toBe('Untitled 3');
		expect(uniqueName(directory, 'Fresh', '.ndesign')).toBe('Fresh');
	});
});

describe('directory contents', () => {
	it('lists folders and design files, skipping hidden and dependency directories', () => {
		mkdirSync(path.join(directory, 'B'));
		mkdirSync(path.join(directory, 'A'));
		mkdirSync(path.join(directory, '.git'));
		mkdirSync(path.join(directory, 'node_modules'));
		writeFileSync(path.join(directory, 'z.ndesign'), '');
		writeFileSync(path.join(directory, 'a.ndesign'), '');
		writeFileSync(path.join(directory, 'notes.txt'), '');
		expect(readDirectory(directory)).toEqual({
			folders: ['A', 'B'],
			files: ['a.ndesign', 'z.ndesign']
		});
		expect(readDirectory(path.join(directory, 'missing'))).toEqual({ folders: [], files: [] });
	});
});

describe('linked folders store', () => {
	it('adds once, persists and removes', () => {
		const store = new LinkedFoldersStore(path.join(directory, 'linked.json'));
		const entry = store.add('/some/repo');
		expect(entry).toMatchObject({ name: 'repo', path: '/some/repo' });
		expect(store.add('/some/repo').id).toBe(entry.id);
		expect(new LinkedFoldersStore(path.join(directory, 'linked.json')).list()).toEqual([entry]);
		store.remove(entry.id);
		expect(store.list()).toEqual([]);
	});

	it('survives a corrupt file', () => {
		writeFileSync(path.join(directory, 'linked.json'), '{nope');
		expect(new LinkedFoldersStore(path.join(directory, 'linked.json')).list()).toEqual([]);
	});
});

describe('recent files store', () => {
	it('replaces a path in place and drops a duplicate of the new path', () => {
		const store = new RecentFilesStore(path.join(directory, 'recent.json'));
		store.record('/a.ndesign', 'a', 1);
		store.record('/b.ndesign', 'b', 2);
		store.record('/c.ndesign', 'c', 3);
		store.replace('/b.ndesign', '/c.ndesign', 'c');
		expect(store.entries().map((entry) => entry.path)).toEqual(['/c.ndesign', '/a.ndesign']);
		store.replace('/a.ndesign', '/x.ndesign', 'x');
		expect(store.entries()[1]).toMatchObject({ path: '/x.ndesign', name: 'x', openedAt: 1 });
		store.replace('/unknown.ndesign', '/y.ndesign', 'y');
		expect(store.entries()).toHaveLength(2);
	});
});
