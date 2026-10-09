import { describe, expect, it } from 'vitest';
import type { DocumentStore, NodeId, Rect } from '../document';
import { frame, group, page } from '../document/fixtures';
import { planDuplicate } from './duplicate';
import { applyTo, at, box, storeOf } from './fixtures/editingFixture';

const view: Rect = { x: -100, y: -100, width: 1200, height: 800 };

function scene(): DocumentStore {
	return storeOf([
		page(
			'Page',
			[
				frame({ id: 'a', name: 'A', transform: at(0, 0), width: 200, height: 150 }),
				frame({ id: 'x', name: 'X', transform: at(300, 400), width: 100, height: 100 }),
				frame({ id: 'host', name: 'Host', transform: at(0, 300), width: 300, height: 200 }, [
					frame({ id: 'inner', name: 'Inner', transform: at(20, 20), width: 50, height: 50 })
				]),
				group({ id: 'g', name: 'G', transform: at(1000, 0), width: 100, height: 50 }, [
					box('g1', 0, 0, 100, 50)
				]),
				box('r', 800, 200, 50, 50)
			],
			{ id: 'p' }
		)
	]);
}

function duplicate(store: DocumentStore, ids: NodeId[], viewport: Rect | null = view): NodeId[] {
	const plan = planDuplicate(store, ids, { x: 0, y: 0 }, viewport);
	applyTo(store, plan.changes);
	return plan.cloneIds;
}

function topLeft(store: DocumentStore, id: NodeId): [number, number] {
	const bounds = store.cache.absoluteBounds(id);
	return [bounds.x, bounds.y];
}

describe('duplicate placement', () => {
	it('pushes a top-level frame right with a gap of 40, again and again', () => {
		const store = scene();
		const [first] = duplicate(store, ['a']);
		expect(topLeft(store, first)).toEqual([240, 0]);
		const [second] = duplicate(store, [first]);
		expect(topLeft(store, second)).toEqual([480, 0]);
		const [third] = duplicate(store, ['a']);
		expect(topLeft(store, third)).toEqual([720, 0]);
	});

	it('moves past anything it would overlap, using bounding boxes', () => {
		const store = scene();
		applyTo(store, [{ t: 'set', id: 'x', set: { transform: at(240, 0) }, prev: {} }]);
		const [copy] = duplicate(store, ['a']);
		expect(topLeft(store, copy)).toEqual([380, 0]);
	});

	it('leaves rectangles, groups, nested frames and several nodes in place', () => {
		const store = scene();
		const [rectangle] = duplicate(store, ['r']);
		expect(topLeft(store, rectangle)).toEqual([800, 200]);
		const [grouped] = duplicate(store, ['g']);
		expect(topLeft(store, grouped)).toEqual([1000, 0]);
		const [nested] = duplicate(store, ['inner']);
		expect(topLeft(store, nested)).toEqual([20, 320]);
		const several = duplicate(store, ['r', 'x']);
		expect(several.map((id) => topLeft(store, id))).toEqual([
			[300, 400],
			[800, 200]
		]);
	});

	it('centres a node whose original is out of view in the view, then pushes frames', () => {
		const store = scene();
		const away: Rect = { x: 5000, y: 5000, width: 1000, height: 800 };
		const [rectangle] = duplicate(store, ['r'], away);
		expect(topLeft(store, rectangle)).toEqual([5475, 5375]);
		const fresh = scene();
		const [nested] = duplicate(fresh, ['inner'], away);
		expect(topLeft(fresh, nested)).toEqual([5475, 5375]);
		expect(fresh.requireNode(nested).parentId).toBe('host');
		const [framed] = duplicate(store, ['a'], away);
		expect(topLeft(store, framed)).toEqual([5565, 5325]);
	});

	it('uses the plain offset without a view', () => {
		const store = scene();
		const plan = planDuplicate(store, ['a'], { x: 10, y: 5 }, null);
		applyTo(store, plan.changes);
		expect(topLeft(store, plan.cloneIds[0])).toEqual([10, 5]);
		expect(plan.placedBounds).toMatchObject({ x: 10, y: 5, width: 200, height: 150 });
	});
});
