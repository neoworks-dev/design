import { describe, expect, it } from 'vitest';
import { frame, page } from '../document/fixtures';
import { clusterRows, planAlign, planDistribute, planTidyUp, uniformGap } from './align';
import { applyTo, at, box, storeOf } from './fixtures/editingFixture';

function boundsOf(store: ReturnType<typeof storeOf>, id: string): number[] {
	const { x, y, width, height } = store.cache.absoluteBounds(id);
	return [x, y, width, height];
}

describe('planAlign', () => {
	const scatter = (): ReturnType<typeof storeOf> =>
		storeOf([
			page('P', [box('a', 10, 50, 20, 10), box('b', 40, 20, 30, 40), box('c', 90, 0, 10, 10)], {
				id: 'p'
			})
		]);

	it('aligns several nodes to the selection bounds on every edge', () => {
		const cases: Array<[Parameters<typeof planAlign>[2], string, number[]]> = [
			['left', 'b', [10, 20, 30, 40]],
			['right', 'a', [80, 50, 20, 10]],
			['top', 'a', [10, 0, 20, 10]],
			['bottom', 'c', [90, 50, 10, 10]],
			['horizontal-center', 'c', [50, 0, 10, 10]],
			['vertical-center', 'a', [10, 25, 20, 10]]
		];
		for (const [edge, id, expected] of cases) {
			const store = scatter();
			applyTo(store, planAlign(store, ['a', 'b', 'c'], edge));
			expect(boundsOf(store, id), edge).toEqual(expected);
		}
	});

	it('aligns a single node to its parent frame and does nothing directly on a page', () => {
		const store = storeOf([
			page(
				'P',
				[
					frame({ id: 'f', name: 'F', transform: at(100, 100), width: 200, height: 100 }, [
						box('a', 10, 10, 20, 20)
					]),
					box('loose', 5, 5)
				],
				{ id: 'p' }
			)
		]);
		applyTo(store, planAlign(store, ['a'], 'right'));
		expect(boundsOf(store, 'a')).toEqual([280, 110, 20, 20]);
		applyTo(store, planAlign(store, ['a'], 'vertical-center'));
		expect(boundsOf(store, 'a')[1]).toBe(140);
		expect(planAlign(store, ['loose'], 'left')).toEqual([]);
	});

	it('leaves locked nodes and auto layout children in place but uses locked ones as reference', () => {
		const store = scatter();
		applyTo(store, [{ t: 'set', id: 'c', set: { locked: true }, prev: { locked: false } }]);
		applyTo(store, planAlign(store, ['a', 'b', 'c'], 'left'));
		expect(boundsOf(store, 'c')).toEqual([90, 0, 10, 10]);
		expect(boundsOf(store, 'a')[0]).toBe(10);
	});
});

describe('planDistribute', () => {
	it('spreads the nodes between the outermost ones into equal gaps, on both axes', () => {
		const store = storeOf([
			page('P', [box('a', 0, 0, 10, 10), box('b', 20, 30, 20, 10), box('c', 100, 100, 10, 10)], {
				id: 'p'
			})
		]);
		applyTo(store, planDistribute(store, ['a', 'b', 'c'], 'horizontal'));
		expect(boundsOf(store, 'b')[0]).toBe(45);
		expect(boundsOf(store, 'a')[0]).toBe(0);
		expect(boundsOf(store, 'c')[0]).toBe(100);
		applyTo(store, planDistribute(store, ['a', 'b', 'c'], 'vertical'));
		expect(boundsOf(store, 'b')[1]).toBe(50);
	});

	it('needs at least three nodes', () => {
		const store = storeOf([page('P', [box('a', 0, 0), box('b', 50, 0)], { id: 'p' })]);
		expect(planDistribute(store, ['a', 'b'], 'horizontal')).toEqual([]);
	});
});

describe('tidy up', () => {
	it('clusters rows by vertical overlap, sorted left to right', () => {
		const store = storeOf([
			page('P', [box('a', 50, 0, 10, 10), box('b', 0, 5, 10, 10), box('c', 0, 40, 10, 10)], {
				id: 'p'
			})
		]);
		const participants = ['a', 'b', 'c'].map((id) => ({
			id,
			bounds: store.cache.absoluteBounds(id),
			locked: false
		}));
		const rows = clusterRows(participants).map((row) => row.map((entry) => entry.id));
		expect(rows).toEqual([['b', 'a'], ['c']]);
	});

	it('uses the most common gap, else the average, never a negative one', () => {
		expect(uniformGap([10, 10, 30])).toBe(10);
		expect(uniformGap([10, 20])).toBe(15);
		expect(uniformGap([-5, -5])).toBe(0);
		expect(uniformGap([])).toBe(0);
	});

	it('snaps rows into a grid with a uniform gap', () => {
		const store = storeOf([
			page(
				'P',
				[
					box('a', 0, 0, 10, 10),
					box('b', 20, 2, 10, 10),
					box('c', 45, 1, 10, 10),
					box('d', 3, 40, 10, 10),
					box('e', 28, 44, 10, 10)
				],
				{ id: 'p' }
			)
		]);
		applyTo(store, planTidyUp(store, ['a', 'b', 'c', 'd', 'e']));
		expect(boundsOf(store, 'a').slice(0, 2)).toEqual([0, 0]);
		const gapAB = boundsOf(store, 'b')[0] - 10;
		const gapBC = boundsOf(store, 'c')[0] - (boundsOf(store, 'b')[0] + 10);
		expect(gapAB).toBe(gapBC);
		expect(boundsOf(store, 'b')[1]).toBe(0);
		expect(boundsOf(store, 'd')[0]).toBe(0);
		expect(boundsOf(store, 'e')[0]).toBe(10 + gapAB);
		expect(boundsOf(store, 'd')[1]).toBeGreaterThan(10);
	});
});
