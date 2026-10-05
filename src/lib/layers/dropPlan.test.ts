import { describe, expect, it } from 'vitest';
import { applyChanges, DocumentStore, type NodeId } from '../document';
import { buildDocument, frame, page } from '../document/fixtures';
import { at, box } from '../editing/fixtures/editingFixture';
import { draggableIds, dropZone, planLayerDrop, resolveDrop } from './dropPlan';
import { flattenLayers, type LayerRow } from './tree';

// page p: [f [a b c], g [d], loose]  (stored bottom to top)
function sample(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page(
				'P',
				[
					frame({ id: 'f', name: 'F', transform: at(100, 100), width: 300, height: 300 }, [
						box('a', 0, 0),
						box('b', 20, 20),
						box('c', 40, 40)
					]),
					frame({ id: 'g', name: 'G', transform: at(500, 0), width: 100, height: 100 }, [
						box('d', 5, 5)
					]),
					box('loose', 700, 700)
				],
				{ id: 'p' }
			)
		])
	);
}

function order(store: DocumentStore, parentId: NodeId): NodeId[] {
	return store.childNodes(parentId).map((node) => node.id);
}

function rowsOf(store: DocumentStore, open: NodeId[]): LayerRow[] {
	return flattenLayers(store, 'p', { isExpanded: (id) => open.includes(id) });
}

describe('planLayerDrop', () => {
	it('reorders within a parent', () => {
		const store = sample();
		const changes = planLayerDrop(store, ['a'], { parentId: 'f', belowId: 'c' });
		expect(changes).not.toBeNull();
		applyChanges(store, changes ?? []);
		expect(order(store, 'f')).toEqual(['b', 'c', 'a']);
	});

	it('reparents and keeps the absolute position', () => {
		const store = sample();
		const before = store.cache.absoluteBounds('b');
		applyChanges(store, planLayerDrop(store, ['b'], { parentId: 'g', belowId: null }) ?? []);
		expect(store.requireNode('b').parentId).toBe('g');
		expect(order(store, 'g')).toEqual(['b', 'd']);
		expect(store.cache.absoluteBounds('b')).toEqual(before);
	});

	it('moves several layers together, keeping their relative order', () => {
		const store = sample();
		applyChanges(store, planLayerDrop(store, ['a', 'c'], { parentId: 'g', belowId: 'd' }) ?? []);
		expect(order(store, 'g')).toEqual(['d', 'a', 'c']);
		expect(order(store, 'f')).toEqual(['b']);
	});

	it('rejects a drop into the layer itself or its descendants', () => {
		const store = sample();
		expect(planLayerDrop(store, ['f'], { parentId: 'f', belowId: null })).toBeNull();
		expect(planLayerDrop(store, ['f'], { parentId: 'a', belowId: null })).toBeNull();
		expect(planLayerDrop(store, ['a'], { parentId: 'loose', belowId: null })).toBeNull();
	});

	it('plans nothing when the layers already sit there', () => {
		const store = sample();
		expect(planLayerDrop(store, ['b'], { parentId: 'f', belowId: 'a' })).toEqual([]);
	});
});

describe('draggableIds', () => {
	it('keeps only top-level selected layers, bottom-most first', () => {
		const store = sample();
		expect(draggableIds(store, ['c', 'f', 'a', 'loose'])).toEqual(['f', 'loose']);
		expect(draggableIds(store, ['c', 'a'])).toEqual(['a', 'c']);
	});
});

describe('resolveDrop', () => {
	// rows with f open: 0 loose, 1 g, 2 f, 3 c, 4 b, 5 a
	function resolve(
		zone: 'before' | 'after' | 'inside',
		rowIndex: number,
		depth = 0
	): ReturnType<typeof resolveDrop> {
		const store = sample();
		const rows = rowsOf(store, ['f']);
		return resolveDrop(store, rows, 'p', rowIndex, zone, depth, ['loose']);
	}

	it('zones: containers split into thirds, leaves into halves', () => {
		const store = sample();
		expect(dropZone(store.requireNode('f'), 0.5)).toBe('inside');
		expect(dropZone(store.requireNode('f'), 0.1)).toBe('before');
		expect(dropZone(store.requireNode('a'), 0.6)).toBe('after');
	});

	it('a line above a row drops right above it in its parent', () => {
		expect(resolve('before', 3)?.destination).toEqual({ parentId: 'f', belowId: 'c' });
	});

	it('a line below a row drops right under it', () => {
		expect(resolve('after', 3)?.destination).toEqual({ parentId: 'f', belowId: 'b' });
	});

	it('the middle of a container row nests on top of its children', () => {
		const drop = resolve('inside', 1);
		expect(drop?.destination).toEqual({ parentId: 'g', belowId: 'd' });
		expect(drop?.indicator).toEqual({ kind: 'inside', rowId: 'g' });
	});

	it('the middle of a leaf row is not a nesting target', () => {
		expect(resolve('inside', 0)).toBeNull();
	});

	it('below an expanded container the drop goes inside it at the top', () => {
		expect(resolve('after', 2)?.destination).toEqual({ parentId: 'f', belowId: 'c' });
	});

	it('below the bottom child of a container, the indent level picks the parent', () => {
		expect(resolve('after', 5, 1)?.destination).toEqual({ parentId: 'f', belowId: null });
		expect(resolve('after', 5, 0)?.destination).toEqual({ parentId: 'p', belowId: null });
	});

	it('refuses to drop a layer into itself', () => {
		const store = sample();
		const rows = rowsOf(store, ['f']);
		expect(resolveDrop(store, rows, 'p', 2, 'inside', 0, ['f'])).toBeNull();
		expect(resolveDrop(store, rows, 'p', 3, 'inside', 0, ['f'])).toBeNull();
	});

	it('below the last row drops at the bottom of the page', () => {
		const store = sample();
		const rows = rowsOf(store, []);
		const drop = resolveDrop(store, rows, 'p', rows.length, 'after', 0, ['loose']);
		expect(drop?.destination).toEqual({ parentId: 'p', belowId: null });
	});
});
