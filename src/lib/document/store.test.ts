import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { buildDocument, frame, group, page, rectangle } from './fixtures';
import { parseDesignDocument } from './schema';
import { DocumentStore, invertChange, invertChanges } from './store';
import { indexAtPosition, planMove, planRebalance, planReorder } from './treeOps';

// n1 page A: n2 frame (n3 rect, n4 rect, n5 group (n6 rect)), n7 frame ; n8 page B
function sampleStore(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page('A', [
				frame({ name: 'F1' }, [
					rectangle({ name: 'R1' }),
					rectangle({ name: 'R2' }),
					group({ name: 'G' }, [rectangle({ name: 'R3' })])
				]),
				frame({ name: 'F2' })
			]),
			page('B')
		])
	);
}

function names(store: DocumentStore, parentId: string | null): string[] {
	return store.childNodes(parentId).map((child) => child.name);
}

describe('fixtures', () => {
	it('builds a schema-valid document', () => {
		const document = sampleStore().document;
		expect(Object.keys(document.nodes)).toHaveLength(8);
		expect(parseDesignDocument(document).ok).toBe(true);
	});
});

describe('tree queries', () => {
	it('lists pages and children in index order', () => {
		const store = sampleStore();
		expect(names(store, null)).toEqual(['A', 'B']);
		expect(names(store, 'n1')).toEqual(['F1', 'F2']);
		expect(names(store, 'n2')).toEqual(['R1', 'R2', 'G']);
		expect(store.children('n3')).toEqual([]);
	});

	it('returns ancestors nearest first and descendants parents before children', () => {
		const store = sampleStore();
		expect(store.ancestors('n6').map((node) => node.name)).toEqual(['G', 'F1', 'A']);
		expect(store.descendants('n2').map((node) => node.name)).toEqual(['R1', 'R2', 'G', 'R3']);
		expect(store.descendants('n1').map((node) => node.name)).toEqual([
			'F1',
			'R1',
			'R2',
			'G',
			'R3',
			'F2'
		]);
	});

	it('answers isDescendantOf and pageOf', () => {
		const store = sampleStore();
		expect(store.isDescendantOf('n6', 'n2')).toBe(true);
		expect(store.isDescendantOf('n2', 'n6')).toBe(false);
		expect(store.isDescendantOf('n2', 'n2')).toBe(false);
		expect(store.pageOf('n6').name).toBe('A');
	});

	it('does not see inherited object properties as nodes', () => {
		const store = sampleStore();
		expect(store.getNode('constructor')).toBeUndefined();
		expect(store.getNode('__proto__')).toBeUndefined();
	});
});

describe('reorder', () => {
	it('moves a node to the front, the middle and the end', () => {
		const store = sampleStore();
		store.apply(planReorder(store, 'n5', 0));
		expect(names(store, 'n2')).toEqual(['G', 'R1', 'R2']);
		store.apply(planReorder(store, 'n5', 1));
		expect(names(store, 'n2')).toEqual(['R1', 'G', 'R2']);
		store.apply(planReorder(store, 'n5', 99));
		expect(names(store, 'n2')).toEqual(['R1', 'R2', 'G']);
	});

	it('changes only the moved node', () => {
		const store = sampleStore();
		const before = store.requireNode('n3');
		const change = planReorder(store, 'n5', 0);
		store.apply(change);
		expect(store.requireNode('n3')).toBe(before);
	});

	it('reorders pages', () => {
		const store = sampleStore();
		store.apply(planReorder(store, 'n8', 0));
		expect(names(store, null)).toEqual(['B', 'A']);
	});

	it('undoes through the inverse', () => {
		const store = sampleStore();
		const change = planReorder(store, 'n5', 0);
		store.apply(change);
		store.apply(invertChange(change));
		expect(names(store, 'n2')).toEqual(['R1', 'R2', 'G']);
	});
});

describe('reparent', () => {
	it('moves a subtree to another parent and page', () => {
		const store = sampleStore();
		store.apply(planMove(store, 'n5', 'n7', 0));
		expect(names(store, 'n2')).toEqual(['R1', 'R2']);
		expect(names(store, 'n7')).toEqual(['G']);
		expect(store.requireNode('n6').parentId).toBe('n5');
		store.apply(planMove(store, 'n7', 'n8', 0));
		expect(store.pageOf('n6').name).toBe('B');
	});

	it('places a node between two siblings', () => {
		const store = sampleStore();
		store.apply(planMove(store, 'n7', 'n2', 1));
		expect(names(store, 'n2')).toEqual(['R1', 'F2', 'R2', 'G']);
	});

	it('records previous parent and index so it inverts', () => {
		const store = sampleStore();
		const original = store.requireNode('n5');
		const change = planMove(store, 'n5', 'n7', 0);
		expect(change).toMatchObject({ prevParent: 'n2', prevIndex: original.index });
		store.apply(change);
		store.apply(invertChange(change));
		expect(store.requireNode('n5')).toMatchObject({ parentId: 'n2', index: original.index });
		expect(names(store, 'n2')).toEqual(['R1', 'R2', 'G']);
		expect(names(store, 'n7')).toEqual([]);
	});
});

describe('cycle and structure rejection', () => {
	it('rejects moving a node into itself or its own descendants', () => {
		const store = sampleStore();
		expect(() => planMove(store, 'n2', 'n2', 0)).toThrow(/own subtree/);
		expect(() => planMove(store, 'n2', 'n5', 0)).toThrow(/own subtree/);
		expect(() => planMove(store, 'n2', 'n6', 0)).toThrow(/cannot have children/);
	});

	it('rejects a raw cyclic move change at apply time too', () => {
		const store = sampleStore();
		const cyclic = {
			t: 'move' as const,
			id: 'n2',
			parent: 'n5',
			index: 'a0',
			prevParent: 'n1',
			prevIndex: 'a0'
		};
		expect(() => store.apply(cyclic)).toThrow(/own subtree/);
		expect(store.requireNode('n2').parentId).toBe('n1');
	});

	it('rejects roots that are not pages, pages that are not roots, and leaf parents', () => {
		const store = sampleStore();
		expect(() => planMove(store, 'n2', null, 0)).toThrow(/only pages/);
		expect(() => planMove(store, 'n1', 'n2', 0)).toThrow(/page n1 must stay a root/);
		expect(() => planMove(store, 'n4', 'n3', 0)).toThrow(/cannot have children/);
	});
});

describe('apply', () => {
	it('adds, sets and deletes nodes', () => {
		const store = sampleStore();
		const added = createNode('RECTANGLE', { id: 'new', parentId: 'n7', index: 'a0', name: 'New' });
		store.apply({ t: 'add', node: added });
		expect(names(store, 'n7')).toEqual(['New']);
		store.apply({ t: 'set', id: 'new', set: { name: 'Renamed' }, prev: { name: 'New' } });
		expect(store.requireNode('new').name).toBe('Renamed');
		expect(added.name).toBe('New');
		store.apply({ t: 'del', node: store.requireNode('new') });
		expect(store.getNode('new')).toBeUndefined();
		expect(names(store, 'n7')).toEqual([]);
	});

	it('treats an undefined value in set as removing the property', () => {
		const store = sampleStore();
		store.apply({
			t: 'set',
			id: 'n3',
			set: { fillStyleId: 's1' },
			prev: { fillStyleId: undefined }
		});
		expect(store.requireNode('n3')).toHaveProperty('fillStyleId', 's1');
		store.apply({
			t: 'set',
			id: 'n3',
			set: { fillStyleId: undefined },
			prev: { fillStyleId: 's1' }
		});
		expect(store.requireNode('n3')).not.toHaveProperty('fillStyleId');
	});

	it('rejects duplicate ids, unknown nodes, protected keys and deleting parents', () => {
		const store = sampleStore();
		expect(() => store.apply({ t: 'add', node: store.requireNode('n3') })).toThrow(
			/already exists/
		);
		expect(() => store.apply({ t: 'set', id: 'nope', set: {}, prev: {} })).toThrow(/not found/);
		expect(() => store.apply({ t: 'set', id: 'n3', set: { index: 'a1' }, prev: {} })).toThrow(
			/move change/
		);
		expect(() => store.apply({ t: 'del', node: store.requireNode('n2') })).toThrow(/children/);
	});

	it('rolls back the whole batch when one change fails', () => {
		const store = sampleStore();
		const before = names(store, 'n2');
		expect(() =>
			store.applyAll([
				planReorder(store, 'n5', 0),
				{ t: 'set', id: 'n3', set: { name: 'X' }, prev: { name: 'R1' } },
				{ t: 'set', id: 'missing', set: {}, prev: {} }
			])
		).toThrow();
		expect(names(store, 'n2')).toEqual(before);
	});

	it('applies library entity changes and inverts them', () => {
		const store = sampleStore();
		const change = {
			t: 'entity-add' as const,
			kind: 'style' as const,
			entity: { id: 's1', type: 'PAINT' as const, name: 'Brand', description: '', value: {} }
		};
		store.apply(change);
		expect(store.document.styles.s1.name).toBe('Brand');
		store.apply({
			t: 'entity-set',
			kind: 'style',
			id: 's1',
			set: { name: 'Brand 2' },
			prev: { name: 'Brand' }
		});
		expect(store.document.styles.s1.name).toBe('Brand 2');
		store.applyAll(invertChanges([change]));
		expect(store.document.styles.s1).toBeUndefined();
	});

	it('inverts a change list in reverse order', () => {
		const store = sampleStore();
		const snapshot = JSON.stringify(store.document);
		const changes = [
			planMove(store, 'n5', 'n7', 0),
			{ t: 'set' as const, id: 'n3', set: { name: 'Z' }, prev: { name: 'R1' } }
		];
		store.applyAll(changes);
		expect(JSON.stringify(store.document)).not.toBe(snapshot);
		store.applyAll(invertChanges(changes));
		expect(JSON.stringify(store.document)).toBe(snapshot);
	});
});

describe('rebalance', () => {
	it('keeps order and shortens indexes after many same-spot inserts', () => {
		const store = sampleStore();
		for (let count = 0; count < 60; count += 1) {
			const index = indexAtPosition(store, 'n2', 1);
			store.apply({
				t: 'add',
				node: createNode('RECTANGLE', { id: `extra-${count}`, parentId: 'n2', index })
			});
		}
		const orderBefore = store.children('n2');
		const longestBefore = Math.max(...store.childNodes('n2').map((node) => node.index.length));
		store.applyAll(planRebalance(store, 'n2'));
		expect(store.children('n2')).toEqual(orderBefore);
		const longestAfter = Math.max(...store.childNodes('n2').map((node) => node.index.length));
		expect(longestAfter).toBeLessThan(longestBefore);
	});
});
