import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rank } from './fuzzy';

describe('fuzzyMatch', () => {
	it('matches an in-order subsequence case-insensitively', () => {
		expect(fuzzyMatch('ztf', 'Zoom to fit')?.indices).toEqual([0, 5, 8]);
		expect(fuzzyMatch('ZTF', 'zoom to fit')).not.toBeNull();
	});

	it('rejects text that lacks the characters in order', () => {
		expect(fuzzyMatch('fz', 'Zoom to fit')).toBeNull();
		expect(fuzzyMatch('q', 'Zoom')).toBeNull();
	});

	it('matches everything for an empty query', () => {
		expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indices: [] });
	});

	it('prefers word starts, prefixes and consecutive runs', () => {
		const prefix = fuzzyMatch('zo', 'Zoom in');
		const scattered = fuzzyMatch('zo', 'Fizz of orbit');
		expect(prefix && scattered && prefix.score > scattered.score).toBe(true);
	});
});

describe('rank', () => {
	it('orders by score and drops non matches', () => {
		const titles = ['Fizz of orbit', 'Zoom in', 'Rename', 'Zoom to fit'];
		const ranked = rank(titles, 'zoom', (title) => title).map((entry) => entry.item);
		expect(ranked).toEqual(['Zoom in', 'Zoom to fit']);
	});

	it('keeps the input order for an empty query', () => {
		const titles = ['b', 'a', 'c'];
		expect(rank(titles, '', (title) => title).map((entry) => entry.item)).toEqual(titles);
	});
});
