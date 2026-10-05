import { describe, expect, it } from 'vitest';
import type { LibraryFile, LibraryOverview } from '../../../electron/bridge';
import {
	breadcrumbsOf,
	directoryOf,
	isLibraryDirectory,
	locationLabel,
	moveDestinations,
	relativeAge,
	sortFiles
} from './library';

function file(name: string, modifiedAt: number, openedAt: number | null = null): LibraryFile {
	return {
		path: `/lib/${name}.ndesign`,
		name,
		modifiedAt,
		openedAt,
		location: { kind: 'library', folder: '' },
		thumbnail: null
	};
}

const overview: LibraryOverview = {
	root: '/lib',
	folders: [
		{ path: '/lib/Work', name: 'Work', fileCount: 2, modifiedAt: 1 },
		{ path: '/lib/Art', name: 'Art', fileCount: 0, modifiedAt: 1 }
	],
	linked: [
		{ id: 'l1', name: 'team-repo', path: '/home/me/team-repo', available: true },
		{ id: 'l2', name: 'usb', path: '/mnt/usb', available: false }
	]
};

describe('sortFiles', () => {
	const files = [file('beta', 20, 5), file('Alpha', 10, 30), file('gamma', 35, null)];
	const names = (sort: 'edited' | 'opened' | 'name'): string[] =>
		sortFiles(files, sort).map((entry) => entry.name);

	it('sorts by last edited, newest first', () => {
		expect(names('edited')).toEqual(['gamma', 'beta', 'Alpha']);
	});

	it('sorts by last opened; a file never opened counts as opened when it was edited', () => {
		expect(names('opened')).toEqual(['gamma', 'Alpha', 'beta']);
	});

	it('sorts by name ignoring case, and does not touch the input', () => {
		expect(names('name')).toEqual(['Alpha', 'beta', 'gamma']);
		expect(files.map((entry) => entry.name)).toEqual(['beta', 'Alpha', 'gamma']);
	});
});

describe('directories', () => {
	it('finds the directory of a path with either separator', () => {
		expect(directoryOf('/lib/Work/a.ndesign')).toBe('/lib/Work');
		expect(directoryOf('C:\\lib\\a.ndesign')).toBe('C:\\lib');
	});

	it('tells library directories from linked ones', () => {
		expect(isLibraryDirectory(overview, '/lib')).toBe(true);
		expect(isLibraryDirectory(overview, '/lib/Work')).toBe(true);
		expect(isLibraryDirectory(overview, '/home/me/team-repo')).toBe(false);
		expect(isLibraryDirectory(overview, '/home/me/team-repo/sub')).toBe(false);
	});

	it('builds the breadcrumbs of Drafts, a folder, a linked folder and its subdirectory', () => {
		const labels = (path: string): string[] =>
			breadcrumbsOf(overview, path).map((crumb) => crumb.label);
		expect(labels('/lib')).toEqual(['Drafts']);
		expect(labels('/lib/Work')).toEqual(['Work']);
		expect(labels('/home/me/team-repo')).toEqual(['team-repo']);
		expect(labels('/home/me/team-repo/screens')).toEqual(['team-repo', 'screens']);
		expect(breadcrumbsOf(overview, '/home/me/team-repo/screens')[0].path).toBe(
			'/home/me/team-repo'
		);
	});

	it('lists the destinations a file can move to: root, folders by name, available linked folders', () => {
		expect(moveDestinations(overview)).toEqual([
			{ label: 'Drafts', directory: '/lib' },
			{ label: 'Art', directory: '/lib/Art' },
			{ label: 'Work', directory: '/lib/Work' },
			{ label: 'team-repo', directory: '/home/me/team-repo' }
		]);
	});
});

describe('locationLabel', () => {
	const at = (location: LibraryFile['location']): LibraryFile => ({
		...file('a', 1),
		location
	});

	it('words where a file lives', () => {
		expect(locationLabel(at({ kind: 'library', folder: '' }), overview)).toBe('Drafts');
		expect(locationLabel(at({ kind: 'library', folder: 'Work' }), overview)).toBe('Work');
		expect(locationLabel(at({ kind: 'linked', linkedId: 'l1', folder: '' }), overview)).toBe(
			'team-repo'
		);
		expect(locationLabel(at({ kind: 'linked', linkedId: 'l1', folder: 'screens' }), overview)).toBe(
			'team-repo / screens'
		);
		expect(locationLabel(at({ kind: 'external' }), overview)).toBe('Elsewhere');
	});
});

describe('relativeAge', () => {
	const now = 1_000_000_000_000;
	const day = 86_400_000;

	it('words times up to years', () => {
		expect(relativeAge(now - 5_000, now)).toBe('just now');
		expect(relativeAge(now - 5 * 60_000, now)).toBe('5 minutes ago');
		expect(relativeAge(now - 2 * day, now)).toBe('2 days ago');
		expect(relativeAge(now - 61 * day, now)).toBe('2 months ago');
		expect(relativeAge(now - 400 * day, now)).toBe('1 year ago');
	});

	it('treats the future as just now', () => {
		expect(relativeAge(now + 5_000, now)).toBe('just now');
	});
});
