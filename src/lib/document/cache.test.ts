import { describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from './fixtures';
import { DocumentStore } from './store';
import { planMove } from './treeOps';
import type { Matrix2x3, Node } from './types';

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

// page n1 > frame n2 (at 100,50) > frame n3 (at 10,10) > rect n4 (at 5,5, 20x10); frame n5 (at 400,0)
function sampleStore(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page('P', [
				frame({ transform: translation(100, 50), width: 300, height: 300 }, [
					frame({ transform: translation(10, 10), width: 100, height: 100 }, [
						rectangle({ transform: translation(5, 5), width: 20, height: 10 })
					])
				]),
				frame({ transform: translation(400, 0), width: 50, height: 50 })
			])
		])
	);
}

describe('absolute transform and bounds', () => {
	it('composes transforms down the tree', () => {
		const store = sampleStore();
		expect(store.cache.absoluteTransform('n4')).toEqual(translation(115, 65));
		expect(store.cache.absoluteBounds('n4')).toEqual({ x: 115, y: 65, width: 20, height: 10 });
	});

	it('takes rotation into account for bounds', () => {
		const store = sampleStore();
		const quarterTurn: Matrix2x3 = [
			[0, -1, 0],
			[1, 0, 0]
		];
		store.apply({ t: 'set', id: 'n4', set: { transform: quarterTurn }, prev: {} });
		const bounds = store.cache.absoluteBounds('n4');
		expect(bounds.width).toBeCloseTo(10);
		expect(bounds.height).toBeCloseTo(20);
		expect(bounds.x).toBeCloseTo(100);
		expect(bounds.y).toBeCloseTo(60);
	});

	it('is lazy: nothing is computed until read, and a read caches the chain', () => {
		const store = sampleStore();
		expect(store.cache.computeCount).toBe(0);
		store.cache.absoluteTransform('n4');
		expect(store.cache.computeCount).toBe(4);
		store.cache.absoluteTransform('n4');
		store.cache.absoluteTransform('n3');
		expect(store.cache.computeCount).toBe(4);
	});
});

describe('cache invalidation', () => {
	it('invalidates the subtree of a node whose transform changed, and only that', () => {
		const store = sampleStore();
		store.cache.absoluteBounds('n4');
		store.cache.absoluteBounds('n5');
		store.apply({ t: 'set', id: 'n3', set: { transform: translation(0, 0) }, prev: {} });
		expect(store.cache.isTransformCached('n3')).toBe(false);
		expect(store.cache.isTransformCached('n4')).toBe(false);
		expect(store.cache.isBoundsCached('n4')).toBe(false);
		expect(store.cache.isTransformCached('n2')).toBe(true);
		expect(store.cache.isTransformCached('n5')).toBe(true);
		expect(store.cache.absoluteBounds('n4')).toEqual({ x: 105, y: 55, width: 20, height: 10 });
	});

	it('recomputes only the invalidated chain on the next read', () => {
		const store = sampleStore();
		store.cache.absoluteTransform('n4');
		const before = store.cache.computeCount;
		store.apply({ t: 'set', id: 'n3', set: { transform: translation(0, 0) }, prev: {} });
		store.cache.absoluteTransform('n4');
		expect(store.cache.computeCount - before).toBe(2);
	});

	it('a size change drops that node bounds but keeps transforms and descendants', () => {
		const store = sampleStore();
		store.cache.absoluteBounds('n3');
		store.cache.absoluteBounds('n4');
		store.apply({ t: 'set', id: 'n3', set: { width: 500 }, prev: { width: 100 } });
		expect(store.cache.isBoundsCached('n3')).toBe(false);
		expect(store.cache.isTransformCached('n3')).toBe(true);
		expect(store.cache.isBoundsCached('n4')).toBe(true);
		expect(store.cache.absoluteBounds('n3').width).toBe(500);
	});

	it('unrelated property changes keep the cache', () => {
		const store = sampleStore();
		store.cache.absoluteBounds('n4');
		store.apply({ t: 'set', id: 'n4', set: { name: 'x' }, prev: { name: 'Rectangle' } });
		expect(store.cache.isBoundsCached('n4')).toBe(true);
	});

	it('reparenting recomputes against the new parent', () => {
		const store = sampleStore();
		expect(store.cache.absoluteBounds('n4').x).toBe(115);
		store.apply(planMove(store, 'n4', 'n5', 0));
		expect(store.cache.absoluteBounds('n4')).toEqual({ x: 405, y: 5, width: 20, height: 10 });
	});

	it('deleting and re-adding a node does not resurrect a stale value', () => {
		const store = sampleStore();
		const node = store.requireNode('n4');
		store.cache.absoluteBounds('n4');
		store.apply({ t: 'del', node });
		store.apply({ t: 'add', node: { ...node, parentId: 'n5' } as Node });
		expect(store.cache.absoluteBounds('n4').x).toBe(405);
	});

	it('undo restores the earlier bounds', () => {
		const store = sampleStore();
		const original = store.requireNode('n2');
		if (original.type === 'PAGE') throw new Error('unexpected page');
		store.cache.absoluteBounds('n4');
		store.apply({
			t: 'set',
			id: 'n2',
			set: { transform: translation(0, 0) },
			prev: { transform: original.transform }
		});
		expect(store.cache.absoluteBounds('n4').x).toBe(15);
		store.apply({
			t: 'set',
			id: 'n2',
			set: { transform: original.transform },
			prev: { transform: translation(0, 0) }
		});
		expect(store.cache.absoluteBounds('n4').x).toBe(115);
	});
});
