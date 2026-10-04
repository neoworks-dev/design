import { describe, expect, it } from 'vitest';
import { page } from '../document/fixtures';
import { planMaskToggle, planSetMaskType, selectionHasMask } from './mask';
import { applyTo, box, orderOf, storeOf } from './fixtures/editingFixture';

function threeBoxes(): ReturnType<typeof storeOf> {
	return storeOf([page('P', [box('a', 0, 0), box('b', 5, 5), box('c', 10, 10)], { id: 'p' })]);
}

function flag(store: ReturnType<typeof storeOf>, id: string, key: string): unknown {
	return Reflect.get(store.requireNode(id), key);
}

describe('planMaskToggle', () => {
	it('groups several layers and makes the topmost one the mask', () => {
		const store = threeBoxes();
		const plan = planMaskToggle(store, ['a', 'c'], 'g');
		expect(plan).not.toBeNull();
		applyTo(store, plan?.changes ?? []);
		expect(plan?.selectIds).toEqual(['g']);
		expect(orderOf(store, 'p')).toEqual(['b', 'g']);
		expect(orderOf(store, 'g')).toEqual(['a', 'c']);
		expect(flag(store, 'c', 'isMask')).toBe(true);
		expect(flag(store, 'a', 'isMask')).toBe(false);
	});

	it('masks a single layer in place without grouping', () => {
		const store = threeBoxes();
		const plan = planMaskToggle(store, ['b'], 'g');
		applyTo(store, plan?.changes ?? []);
		expect(orderOf(store, 'p')).toEqual(['a', 'b', 'c']);
		expect(flag(store, 'b', 'isMask')).toBe(true);
		expect(plan?.selectIds).toEqual(['b']);
	});

	it('removes the masking again and keeps the group', () => {
		const store = threeBoxes();
		applyTo(store, planMaskToggle(store, ['a', 'c'], 'g')?.changes ?? []);
		expect(selectionHasMask(store, ['c'])).toBe(true);
		applyTo(store, planMaskToggle(store, ['c'], 'g2')?.changes ?? []);
		expect(flag(store, 'c', 'isMask')).toBe(false);
		expect(orderOf(store, 'g')).toEqual(['a', 'c']);
	});

	it('does nothing for an empty selection', () => {
		expect(planMaskToggle(threeBoxes(), [], 'g')).toBeNull();
	});
});

describe('planSetMaskType', () => {
	it('changes the type of masks only and skips unchanged ones', () => {
		const store = threeBoxes();
		applyTo(store, planMaskToggle(store, ['b'], 'g')?.changes ?? []);
		expect(planSetMaskType(store, ['a'], 'VECTOR')).toEqual([]);
		expect(planSetMaskType(store, ['b'], 'ALPHA')).toEqual([]);
		applyTo(store, planSetMaskType(store, ['a', 'b'], 'LUMINANCE'));
		expect(flag(store, 'b', 'maskType')).toBe('LUMINANCE');
		expect(flag(store, 'a', 'maskType')).toBe('ALPHA');
	});
});
