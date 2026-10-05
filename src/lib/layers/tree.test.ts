import { describe, expect, it } from 'vitest';
import { containersBelow, flattenLayers, rangeBetween, type LayerSource } from './tree';

// page: [a, f[b, c, g[d]], e] stored bottom to top
const children: Record<string, string[]> = {
	page: ['a', 'f', 'e'],
	f: ['b', 'c', 'g'],
	g: ['d']
};
const source: LayerSource = { children: (id) => children[id] ?? [] };

function ids(rows: ReturnType<typeof flattenLayers>): string[] {
	return rows.map((row) => `${row.depth}:${row.id}`);
}

describe('flattenLayers', () => {
	it('lists the top-most layer first and hides collapsed children', () => {
		const rows = flattenLayers(source, 'page', { isExpanded: () => false });
		expect(ids(rows)).toEqual(['0:e', '0:f', '0:a']);
		expect(rows[1]).toMatchObject({ hasChildren: true, expanded: false });
		expect(rows[0]).toMatchObject({ hasChildren: false });
	});

	it('lists expanded containers with their children indented, top-most first', () => {
		const open = new Set(['f', 'g']);
		const rows = flattenLayers(source, 'page', { isExpanded: (id) => open.has(id) });
		expect(ids(rows)).toEqual(['0:e', '0:f', '1:g', '2:d', '1:c', '1:b', '0:a']);
	});

	it('with an `only` set lists those nodes and expands their ancestors', () => {
		const rows = flattenLayers(source, 'page', {
			isExpanded: () => false,
			only: new Set(['f', 'g', 'd'])
		});
		expect(ids(rows)).toEqual(['0:f', '1:g', '2:d']);
	});
});

describe('rangeBetween', () => {
	const rows = flattenLayers(source, 'page', { isExpanded: () => true });
	it('returns the rows between two ids in either direction', () => {
		expect(rangeBetween(rows, 'f', 'c')).toEqual(['f', 'g', 'd', 'c']);
		expect(rangeBetween(rows, 'c', 'f')).toEqual(['f', 'g', 'd', 'c']);
	});
	it('falls back to the target without an anchor', () => {
		expect(rangeBetween(rows, null, 'c')).toEqual(['c']);
	});
});

describe('containersBelow', () => {
	it('lists the node and its descendant containers only', () => {
		expect(containersBelow(source, 'f').sort()).toEqual(['f', 'g']);
		expect(containersBelow(source, 'a')).toEqual([]);
	});
});

describe('large pages', () => {
	it('flattens 10,000 expanded rows quickly (the list renders only a window of them)', () => {
		const wide: Record<string, string[]> = { page: [] };
		for (let group = 0; group < 100; group += 1) {
			const groupId = `g${group}`;
			wide.page.push(groupId);
			wide[groupId] = Array.from({ length: 99 }, (_, leaf) => `${groupId}-${leaf}`);
		}
		const start = performance.now();
		const rows = flattenLayers({ children: (id) => wide[id] ?? [] }, 'page', {
			isExpanded: () => true
		});
		const elapsed = performance.now() - start;
		expect(rows).toHaveLength(10_000);
		expect(elapsed).toBeLessThan(250);
	});
});
