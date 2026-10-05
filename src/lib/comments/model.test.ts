import { describe, expect, it } from 'vitest';
import {
	COMMENTS_NAMESPACE,
	matchesComment,
	newComment,
	pinHit,
	pinPosition,
	readComments,
	withComment,
	withoutComment,
	type Comment
} from './model';

const base: Comment = newComment({
	id: 'c1',
	pageId: 'p',
	point: { x: 110, y: 220 },
	anchorId: 'n1',
	anchorOrigin: { x: 100, y: 200 },
	text: 'Check the spacing',
	now: 1000
});

describe('stored form', () => {
	it('round trips through the page pluginData', () => {
		const stored = withComment({}, base);
		expect(Object.keys(stored)).toEqual([COMMENTS_NAMESPACE]);
		expect(typeof stored[COMMENTS_NAMESPACE].c1).toBe('string');
		expect(readComments('p', stored)).toEqual([base]);
	});

	it('keeps other plugins data and other comments, oldest first', () => {
		const later = { ...base, id: 'c2', createdAt: 2000 };
		const earlier = { ...base, id: 'c0', createdAt: 500 };
		let data = withComment({ other: { a: 'b' } }, later);
		data = withComment(data, earlier);
		data = withComment(data, base);
		expect(data.other).toEqual({ a: 'b' });
		expect(readComments('p', data).map((comment) => comment.id)).toEqual(['c0', 'c1', 'c2']);
	});

	it('skips entries that do not parse instead of failing', () => {
		const data = {
			[COMMENTS_NAMESPACE]: {
				bad: '{not json',
				missing: JSON.stringify({ x: 1 }),
				wrongType: JSON.stringify({ x: 'a', y: 2, text: 't' }),
				ok: JSON.stringify({ x: 1, y: 2, text: 'fine' })
			}
		};
		expect(readComments('p', data).map((comment) => comment.id)).toEqual(['ok']);
	});

	it('removes a comment and the namespace with the last one', () => {
		const two = withComment(withComment({}, base), { ...base, id: 'c2' });
		const one = withoutComment(two, 'c1');
		expect(readComments('p', one).map((comment) => comment.id)).toEqual(['c2']);
		expect(COMMENTS_NAMESPACE in withoutComment(one, 'c2')).toBe(false);
		expect(withoutComment({}, 'none')).toEqual({});
	});
});

describe('where a pin sits', () => {
	it('follows its node by the offset it was dropped at', () => {
		expect(base.offsetX).toBe(10);
		expect(base.offsetY).toBe(20);
		const moved = pinPosition(base, () => ({ x: 400, y: 50, width: 10, height: 10 }));
		expect(moved).toEqual({ x: 410, y: 70 });
	});

	it('stays where it was dropped when the node is gone or it never had one', () => {
		expect(pinPosition(base, () => undefined)).toEqual({ x: 110, y: 220 });
		const free = newComment({
			id: 'f',
			pageId: 'p',
			point: { x: 5, y: 6 },
			anchorId: null,
			anchorOrigin: null,
			text: 'free',
			now: 1
		});
		expect(pinPosition(free, () => ({ x: 999, y: 999, width: 1, height: 1 }))).toEqual({
			x: 5,
			y: 6
		});
	});
});

describe('search and filter', () => {
	const open = { text: 'Fix the header', resolved: false, pageName: 'Landing' };
	const done = { text: 'Logo is blurry', resolved: true, pageName: 'Landing' };

	it('filters open and resolved', () => {
		expect(matchesComment(open, '', 'open')).toBe(true);
		expect(matchesComment(done, '', 'open')).toBe(false);
		expect(matchesComment(done, '', 'resolved')).toBe(true);
		expect(matchesComment(open, '', 'resolved')).toBe(false);
	});

	it('searches the note and the page name, ignoring case', () => {
		expect(matchesComment(open, 'HEADER', 'all')).toBe(true);
		expect(matchesComment(open, 'landing', 'all')).toBe(true);
		expect(matchesComment(open, 'footer', 'all')).toBe(false);
	});
});

describe('pin hit testing', () => {
	const pins = [
		{ id: 'a', screen: { x: 100, y: 100 } },
		{ id: 'b', screen: { x: 108, y: 100 } }
	];

	it('picks the nearest pin inside the radius, and nothing outside it', () => {
		expect(pinHit(pins, { x: 106, y: 100 }, 11)?.id).toBe('b');
		expect(pinHit(pins, { x: 102, y: 100 }, 11)?.id).toBe('a');
		expect(pinHit(pins, { x: 200, y: 200 }, 11)).toBeUndefined();
	});
});
