import { describe, expect, it } from 'vitest';
import { entryOfDraft, entryOfRecent, visibleEntries, type HomeEntry } from './entries';
import { relativeTime } from './format';

const recent = (name: string, openedAt: number, path = `/docs/${name}.ndesign`): HomeEntry =>
	entryOfRecent({ path, name, openedAt, thumbnail: null });
const draft = (name: string, modifiedAt: number, path = `/untitled/${name}.ndesign`): HomeEntry =>
	entryOfDraft({ path, name, modifiedAt, thumbnail: null });

const all = [recent('Beta', 20), recent('alpha', 10), draft('Scratch', 30)];

describe('visibleEntries', () => {
	it('filters by section', () => {
		const names = (section: 'recents' | 'drafts' | 'all'): string[] =>
			visibleEntries(all, { section, query: '', sort: 'recent' }).map((entry) => entry.name);
		expect(names('recents')).toEqual(['Beta', 'alpha']);
		expect(names('drafts')).toEqual(['Scratch']);
		expect(names('all')).toEqual(['Scratch', 'Beta', 'alpha']);
	});

	it('searches by name, ignoring case and surrounding spaces', () => {
		const found = visibleEntries(all, { section: 'all', query: '  ALP ', sort: 'recent' });
		expect(found.map((entry) => entry.name)).toEqual(['alpha']);
		expect(visibleEntries(all, { section: 'all', query: 'zzz', sort: 'recent' })).toEqual([]);
	});

	it('sorts by last opened, newest first, or by name', () => {
		const byName = visibleEntries(all, { section: 'all', query: '', sort: 'name' });
		expect(byName.map((entry) => entry.name)).toEqual(['alpha', 'Beta', 'Scratch']);
	});

	it('lists a path once', () => {
		const twice = [recent('a', 5, '/x'), draft('a', 9, '/x')];
		expect(visibleEntries(twice, { section: 'all', query: '', sort: 'recent' })).toHaveLength(1);
	});
});

describe('relativeTime', () => {
	const now = 1_000_000_000_000;
	it('words recent times and falls back to a date', () => {
		expect(relativeTime(now - 5_000, now)).toBe('just now');
		expect(relativeTime(now - 60_000, now)).toBe('1 minute ago');
		expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
		expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
		expect(relativeTime(now - 90 * 86_400_000, now)).toBe(
			new Date(now - 90 * 86_400_000).toLocaleDateString()
		);
	});

	it('treats a time in the future as just now', () => {
		expect(relativeTime(now + 5_000, now)).toBe('just now');
	});
});
