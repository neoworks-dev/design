import { describe, expect, it } from 'vitest';
import { frame, group, page, rectangle } from '../document/fixtures';
import { planWrap, planUngroup } from './grouping';
import {
	findNodes,
	planDelete,
	planFlip,
	planRename,
	planSetOpacity,
	planSwapFillAndStroke,
	planToggleLock,
	planToggleVisibility
} from './nodeCommands';
import { planNudge } from './nudge';
import { planZOrder } from './zOrder';
import { applyTo, at, box, orderOf, storeOf } from './fixtures/editingFixture';

function contentFrame(): ReturnType<typeof frame> {
	return frame({ id: 'f', name: 'F', transform: at(100, 100), width: 400, height: 400 }, [
		box('a', 0, 0),
		box('b', 20, 20),
		box('c', 40, 40),
		box('d', 60, 60)
	]);
}

describe('planNudge', () => {
	it('moves nodes by the delta and leaves no change for a zero delta', () => {
		const store = storeOf([page('P', [box('a', 5, 5)], { id: 'p' })]);
		applyTo(store, planNudge(store, ['a'], 1, -2).changes);
		expect(store.cache.absoluteBounds('a')).toMatchObject({ x: 6, y: 3 });
		expect(planNudge(store, ['a'], 0, 0).changes).toEqual([]);
	});

	it('moves in screen axes even when an ancestor is rotated by 90 degrees', () => {
		const rotated = frame(
			{
				id: 'f',
				name: 'F',
				width: 100,
				height: 100,
				transform: [
					[0, -1, 100],
					[1, 0, 0]
				]
			},
			[box('a', 10, 10)]
		);
		const store = storeOf([page('P', [rotated], { id: 'p' })]);
		const before = store.cache.absoluteBounds('a');
		applyTo(store, planNudge(store, ['a'], 10, 0).changes);
		const after = store.cache.absoluteBounds('a');
		expect(after.x - before.x).toBeCloseTo(10);
		expect(after.y - before.y).toBeCloseTo(0);
	});

	it('does not move children of auto layout frames and reports them', () => {
		const layout = frame({ id: 'f', name: 'F', layoutMode: 'HORIZONTAL', width: 200, height: 50 }, [
			box('a', 0, 0),
			rectangle({ id: 'abs', name: 'abs', layoutPositioning: 'ABSOLUTE', transform: at(5, 5) })
		]);
		const store = storeOf([page('P', [layout, box('free', 0, 0)], { id: 'p' })]);
		const plan = planNudge(store, ['a', 'abs', 'free'], 1, 1);
		expect(plan.blockedByAutoLayout).toEqual(['a']);
		applyTo(store, plan.changes);
		expect(store.cache.absoluteBounds('a')).toMatchObject({ x: 0, y: 0 });
		expect(store.cache.absoluteBounds('abs')).toMatchObject({ x: 6, y: 6 });
		expect(store.cache.absoluteBounds('free')).toMatchObject({ x: 1, y: 1 });
	});

	it('moves a selected ancestor once, not its selected descendants again', () => {
		const store = storeOf([page('P', [contentFrame()], { id: 'p' })]);
		applyTo(store, planNudge(store, ['f', 'a'], 10, 0).changes);
		expect(store.cache.absoluteBounds('f').x).toBe(110);
		expect(store.cache.absoluteBounds('a').x).toBe(110);
	});

	it('leaves locked nodes in place', () => {
		const locked = rectangle({ id: 'l', name: 'l', locked: true });
		const store = storeOf([page('P', [locked], { id: 'p' })]);
		expect(planNudge(store, ['l'], 1, 0).changes).toEqual([]);
	});
});

describe('planZOrder', () => {
	function fresh(): ReturnType<typeof storeOf> {
		return storeOf([page('P', [contentFrame()], { id: 'p' })]);
	}

	it('brings to front and sends to back, keeping relative order of a multi selection', () => {
		const store = fresh();
		applyTo(store, planZOrder(store, ['a', 'c'], 'front'));
		expect(orderOf(store, 'f')).toEqual(['b', 'd', 'a', 'c']);
		applyTo(store, planZOrder(store, ['d', 'c'], 'back'));
		expect(orderOf(store, 'f')).toEqual(['d', 'c', 'b', 'a']);
	});

	it('moves one step forward and backward', () => {
		const store = fresh();
		applyTo(store, planZOrder(store, ['b'], 'forward'));
		expect(orderOf(store, 'f')).toEqual(['a', 'c', 'b', 'd']);
		applyTo(store, planZOrder(store, ['b'], 'backward'));
		applyTo(store, planZOrder(store, ['b'], 'backward'));
		expect(orderOf(store, 'f')).toEqual(['b', 'a', 'c', 'd']);
	});

	it('moves a block of adjacent nodes together and non-adjacent ones independently', () => {
		const store = fresh();
		applyTo(store, planZOrder(store, ['a', 'b'], 'forward'));
		expect(orderOf(store, 'f')).toEqual(['c', 'a', 'b', 'd']);
		applyTo(store, planZOrder(store, ['c', 'd'], 'backward'));
		expect(orderOf(store, 'f')).toEqual(['c', 'a', 'd', 'b']);
	});

	it('is a no-op at the edge and only touches selected nodes', () => {
		const store = fresh();
		expect(planZOrder(store, ['d'], 'front')).toEqual([]);
		expect(planZOrder(store, ['a'], 'backward')).toEqual([]);
		const changes = planZOrder(store, ['a'], 'front');
		expect(changes).toHaveLength(1);
	});

	it('works per parent', () => {
		const store = storeOf([
			page('P', [contentFrame(), box('x', 0, 0), box('y', 0, 0)], { id: 'p' })
		]);
		applyTo(store, planZOrder(store, ['a', 'x'], 'front'));
		expect(orderOf(store, 'f')).toEqual(['b', 'c', 'd', 'a']);
		expect(orderOf(store, 'p')).toEqual(['f', 'y', 'x']);
	});

	it('keeps indexes valid after many reorders', () => {
		const store = fresh();
		for (let round = 0; round < 40; round += 1) {
			applyTo(store, planZOrder(store, ['b'], 'forward'));
			applyTo(store, planZOrder(store, ['c'], 'backward'));
		}
		const indexes = store.childNodes('f').map((node) => node.index);
		expect(new Set(indexes).size).toBe(4);
		expect([...indexes].sort()).toEqual(indexes);
	});
});

describe('planWrap', () => {
	function rotatedParent(): ReturnType<typeof frame> {
		return frame(
			{
				id: 'r',
				name: 'R',
				width: 300,
				height: 300,
				transform: [
					[0, -1, 300],
					[1, 0, 20]
				]
			},
			[box('a', 10, 10), box('b', 50, 70), box('c', 5, 5)]
		);
	}

	it('keeps absolute bounds and wraps in the common parent at the topmost z-index', () => {
		const store = storeOf([page('P', [rotatedParent()], { id: 'p' })]);
		const before = ['a', 'b'].map((id) => store.cache.absoluteBounds(id));
		const plan = planWrap(store, ['a', 'b'], 'GROUP', 'g');
		expect(plan).not.toBeNull();
		applyTo(store, plan?.changes ?? []);
		expect(orderOf(store, 'r')).toEqual(['g', 'c']);
		expect(orderOf(store, 'g')).toEqual(['a', 'b']);
		['a', 'b'].forEach((id, position) => {
			const after = store.cache.absoluteBounds(id);
			expect(after.x).toBeCloseTo(before[position].x);
			expect(after.y).toBeCloseTo(before[position].y);
			expect(after.width).toBeCloseTo(before[position].width);
		});
	});

	it('places the wrapper just above the topmost selected sibling', () => {
		const store = storeOf([page('P', [contentFrame()], { id: 'p' })]);
		applyTo(store, planWrap(store, ['a', 'c'], 'GROUP', 'g')?.changes ?? []);
		expect(orderOf(store, 'f')).toEqual(['b', 'g', 'd']);
	});

	it('sizes the wrapper to the union of bounds and numbers default names', () => {
		const store = storeOf([
			page('P', [box('a', 10, 20, 30, 10), box('b', 50, 60, 10, 40)], { id: 'p' })
		]);
		applyTo(store, planWrap(store, ['a', 'b'], 'FRAME', 'f1')?.changes ?? []);
		expect(store.requireNode('f1')).toMatchObject({
			type: 'FRAME',
			name: 'Frame 1',
			width: 50,
			height: 80
		});
		expect(store.cache.absoluteBounds('f1')).toMatchObject({ x: 10, y: 20 });
		applyTo(store, planWrap(store, ['f1'], 'GROUP', 'g1')?.changes ?? []);
		applyTo(store, planWrap(store, ['g1'], 'GROUP', 'g2')?.changes ?? []);
		expect(store.requireNode('g1').name).toBe('Group 1');
		expect(store.requireNode('g2').name).toBe('Group 2');
	});

	it('wraps a single frame in a group and handles nodes from different parents', () => {
		const store = storeOf([page('P', [contentFrame(), box('x', 700, 700)], { id: 'p' })]);
		applyTo(store, planWrap(store, ['f'], 'GROUP', 'g')?.changes ?? []);
		expect(store.requireNode('f').parentId).toBe('g');
		const before = store.cache.absoluteBounds('a');
		applyTo(store, planWrap(store, ['a', 'x'], 'GROUP', 'mixed')?.changes ?? []);
		expect(store.requireNode('x').parentId).toBe('mixed');
		expect(store.requireNode('a').parentId).toBe('mixed');
		expect(store.cache.absoluteBounds('a')).toMatchObject({ x: before.x, y: before.y });
	});

	it('returns null for an empty selection', () => {
		const store = storeOf([page('P', [box('a', 0, 0)], { id: 'p' })]);
		expect(planWrap(store, [], 'GROUP', 'g')).toBeNull();
	});
});

describe('planUngroup', () => {
	it('lifts children with absolute position and z-order preserved', () => {
		const grouped = group({ id: 'g', name: 'G', transform: at(50, 60), width: 100, height: 100 }, [
			box('a', 5, 5),
			box('b', 25, 25)
		]);
		const store = storeOf([
			page('P', [box('below', 0, 0), grouped, box('above', 0, 0)], { id: 'p' })
		]);
		const before = ['a', 'b'].map((id) => store.cache.absoluteBounds(id));
		const plan = planUngroup(store, ['g']);
		applyTo(store, plan.changes);
		expect(plan.liftedIds).toEqual(['a', 'b']);
		expect(orderOf(store, 'p')).toEqual(['below', 'a', 'b', 'above']);
		expect(store.hasNode('g')).toBe(false);
		['a', 'b'].forEach((id, position) => {
			expect(store.cache.absoluteBounds(id)).toMatchObject({
				x: before[position].x,
				y: before[position].y
			});
		});
	});

	it('ungroups frames, skips other nodes and handles several groups at once', () => {
		const one = group({ id: 'g1', name: 'g1' }, [box('a', 0, 0)]);
		const two = frame({ id: 'g2', name: 'g2', transform: at(10, 10) }, [box('b', 1, 1)]);
		const store = storeOf([page('P', [one, two, box('r', 0, 0)], { id: 'p' })]);
		const plan = planUngroup(store, ['g1', 'g2', 'r']);
		applyTo(store, plan.changes);
		expect(orderOf(store, 'p')).toEqual(['a', 'b', 'r']);
		expect(store.cache.absoluteBounds('b')).toMatchObject({ x: 11, y: 11 });
	});

	it('is empty when nothing is a group', () => {
		const store = storeOf([page('P', [box('r', 0, 0)], { id: 'p' })]);
		expect(planUngroup(store, ['r'])).toEqual({ changes: [], liftedIds: [] });
	});
});

describe('quick node commands', () => {
	it('flips about the selection centre and flipping twice restores the transform', () => {
		const store = storeOf([page('P', [box('a', 0, 0), box('b', 30, 0)], { id: 'p' })]);
		const original = store.requireNode('a');
		applyTo(store, planFlip(store, ['a', 'b'], 'horizontal'));
		expect(store.cache.absoluteBounds('a')).toMatchObject({ x: 30, y: 0, width: 10 });
		expect(store.cache.absoluteBounds('b')).toMatchObject({ x: 0, y: 0 });
		applyTo(store, planFlip(store, ['a', 'b'], 'horizontal'));
		expect(store.requireNode('a')).toMatchObject({ transform: Reflect.get(original, 'transform') });
	});

	it('flips vertically in place for a single node', () => {
		const store = storeOf([page('P', [box('a', 5, 5, 10, 20)], { id: 'p' })]);
		applyTo(store, planFlip(store, ['a'], 'vertical'));
		expect(store.cache.absoluteBounds('a')).toMatchObject({ x: 5, y: 5, height: 20 });
		expect(Reflect.get(store.requireNode('a'), 'transform')).toEqual([
			[1, 0, 5],
			[0, -1, 25]
		]);
	});

	it('toggles visibility and lock, converging a mixed selection', () => {
		const store = storeOf([
			page('P', [box('a', 0, 0), rectangle({ id: 'b', name: 'b', visible: false })], { id: 'p' })
		]);
		applyTo(store, planToggleVisibility(store, ['a', 'b']));
		expect(store.requireNode('a')).toMatchObject({ visible: true });
		expect(store.requireNode('b')).toMatchObject({ visible: true });
		applyTo(store, planToggleVisibility(store, ['a', 'b']));
		expect(store.requireNode('a')).toMatchObject({ visible: false });
		applyTo(store, planToggleLock(store, ['a', 'b']));
		expect(store.requireNode('a')).toMatchObject({ locked: true });
		applyTo(store, planToggleLock(store, ['a', 'b']));
		expect(store.requireNode('b')).toMatchObject({ locked: false });
	});

	it('sets opacity and rejects values outside 0 to 1', () => {
		const store = storeOf([page('P', [box('a', 0, 0)], { id: 'p' })]);
		applyTo(store, planSetOpacity(store, ['a'], 0.4));
		expect(store.requireNode('a')).toMatchObject({ opacity: 0.4 });
		expect(() => planSetOpacity(store, ['a'], 1.5)).toThrow(RangeError);
	});

	it('swaps fill and stroke paints, creating a stroke when there is none', () => {
		const red = {
			type: 'SOLID',
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL',
			color: { r: 1, g: 0, b: 0 }
		} as const;
		const blue = { ...red, color: { r: 0, g: 0, b: 1 } };
		const store = storeOf([
			page('P', [rectangle({ id: 'a', name: 'a', fills: [red], strokes: [] })], { id: 'p' })
		]);
		applyTo(store, planSwapFillAndStroke(store, ['a']));
		const created = store.requireNode('a');
		expect(created).toMatchObject({ fills: [] });
		expect(Reflect.get(created, 'strokes')[0].paints).toEqual([red]);
		const withBoth = rectangle({
			id: 'b',
			name: 'b',
			fills: [red],
			strokes: [{ ...Reflect.get(created, 'strokes')[0], paints: [blue] }]
		});
		const second = storeOf([page('P', [withBoth], { id: 'p' })]);
		applyTo(second, planSwapFillAndStroke(second, ['b']));
		expect(second.requireNode('b')).toMatchObject({ fills: [blue] });
		expect(Reflect.get(second.requireNode('b'), 'strokes')[0].paints).toEqual([red]);
	});

	it('deletes selected subtrees once and renames', () => {
		const store = storeOf([page('P', [contentFrame(), box('x', 0, 0)], { id: 'p' })]);
		applyTo(store, planDelete(store, ['f', 'a', 'x']));
		expect(orderOf(store, 'p')).toEqual([]);
		expect(store.hasNode('a')).toBe(false);
		const renamed = storeOf([page('P', [box('x', 0, 0)], { id: 'p' })]);
		applyTo(renamed, planRename(renamed, 'x', '  Hero '));
		expect(renamed.requireNode('x').name).toBe('Hero');
		expect(() => planRename(renamed, 'x', '  ')).toThrow();
	});

	it('finds nodes by name and by text content', () => {
		const store = storeOf([
			page(
				'P',
				[
					box('Button background', 0, 0),
					rectangle({ id: 'r', name: 'other' }),
					{
						type: 'TEXT',
						props: {
							id: 't',
							name: 'Label',
							paragraphs: [
								{
									runs: [{ text: 'Buy a BUTTON now', style: {} }],
									align: 'LEFT',
									indent: 0,
									spacingAfter: 0,
									list: 'NONE',
									listLevel: 0
								}
							]
						},
						children: []
					}
				],
				{ id: 'p' }
			)
		]);
		expect(findNodes(store, 'p', 'button')).toEqual(['Button background', 't']);
		expect(findNodes(store, 'p', 'Button', { caseSensitive: true })).toEqual(['Button background']);
		expect(findNodes(store, 'p', '')).toEqual([]);
	});
});
