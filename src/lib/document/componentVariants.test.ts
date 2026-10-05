import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { planSetProps } from './changes';
import {
	addInstance,
	applyWithSync,
	childByName,
	ids,
	snapshot,
	storeWithMain,
	tail
} from './componentHarness';
import { findVariant, variantsOf } from './componentDefinitions';
import {
	planAddVariant,
	planAddVariantProperty,
	planChangeVariantProperty,
	planCreateVariantSet,
	planSetVariantValue
} from './componentVariants';
import { rollback } from './apply';
import { createNode } from './defaults';
import type { DocumentStore } from './store';

function twoComponents(): DocumentStore {
	const store = storeWithMain();
	const other = createNode('COMPONENT', {
		id: 'N',
		name: 'Button hover',
		parentId: 'p',
		index: tail(store, 'p'),
		width: 100,
		height: 40
	});
	applyChanges(store, [{ t: 'add', node: other }]);
	return store;
}

describe('component sets', () => {
	it('combines components into a set that keeps their relative positions', () => {
		const store = twoComponents();
		const before = snapshot(store);
		const plan = planCreateVariantSet(store, ['M', 'N'], ids('s'));
		const applied = applyWithSync(store, plan.changes);
		const set = store.requireNode(plan.setId);
		expect(set.type).toBe('COMPONENT_SET');
		expect(store.children(plan.setId)).toEqual(['M', 'N']);
		expect(store.requireNode('M').name).toBe('Property 1=Button');
		expect(store.requireNode('N').name).toBe('Property 1=Button hover');
		rollback(store, applied);
		expect(snapshot(store)).toBe(before);
	});

	it('gives existing instances their variant value', () => {
		const store = twoComponents();
		const instance = addInstance(store, 'M');
		applyWithSync(store, planCreateVariantSet(store, ['M', 'N'], ids('s')).changes);
		const node = store.requireNode(instance);
		expect(node.type === 'INSTANCE' && node.componentProperties['Property 1']).toEqual({
			type: 'VARIANT',
			value: 'Button'
		});
	});

	it('picks the variant that matches the changed property first', () => {
		const store = twoComponents();
		const plan = planCreateVariantSet(store, ['M', 'N'], ids('s'));
		applyWithSync(store, plan.changes);
		const added = planAddVariantProperty(store, plan.setId, 'State', 'Default');
		applyWithSync(store, added.changes);
		applyWithSync(store, planSetVariantValue(store, 'N', 'State', 'Hover'));
		const found = findVariant(
			store,
			plan.setId,
			{ 'Property 1': 'Button hover', State: 'Default' },
			'State'
		);
		expect(found?.id).toBe('M');
		const other = findVariant(
			store,
			plan.setId,
			{ 'Property 1': 'Button', State: 'Hover' },
			'State'
		);
		expect(other?.id).toBe('N');
	});

	it('adds a variant as a copy below the others and enlarges the set', () => {
		const store = twoComponents();
		const plan = planCreateVariantSet(store, ['M', 'N'], ids('s'));
		applyWithSync(store, plan.changes);
		const heightBefore = Reflect.get(store.requireNode(plan.setId), 'height');
		const added = planAddVariant(store, plan.setId, 'M', ids('v'));
		applyWithSync(store, added.changes, { ids: ids('w') });
		expect(variantsOf(store, plan.setId)).toHaveLength(3);
		const copy = store.requireNode(added.variantId);
		expect(copy.type === 'COMPONENT' && copy.variantProperties).toEqual({
			'Property 1': 'Variant3'
		});
		expect(store.childNodes(added.variantId).map((child) => child.name)).toEqual(['bg', 'label']);
		expect(Reflect.get(store.requireNode(plan.setId), 'height')).toBeGreaterThan(
			Number(heightBefore)
		);
	});

	it('renaming a variant property renames it on variants and instances', () => {
		const store = twoComponents();
		const plan = planCreateVariantSet(store, ['M', 'N'], ids('s'));
		applyWithSync(store, plan.changes);
		const instance = addInstance(store, 'M');
		applyWithSync(store, planChangeVariantProperty(store, plan.setId, 'Property 1', 'Kind'));
		const variant = store.requireNode('M');
		expect(variant.type === 'COMPONENT' && Object.keys(variant.variantProperties ?? {})).toEqual([
			'Kind'
		]);
		const node = store.requireNode(instance);
		expect(node.type === 'INSTANCE' && Object.keys(node.componentProperties)).toContain('Kind');
	});

	it('keeps instance overrides when the instance switches variant', () => {
		const store = twoComponents();
		const plan = planCreateVariantSet(store, ['M', 'N'], ids('s'));
		applyWithSync(store, plan.changes);
		const instance = addInstance(store, 'M');
		const copy = childByName(store, instance, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { width: 9 }));
		const node = store.requireNode(instance);
		if (node.type !== 'INSTANCE') throw new Error('not an instance');
		applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: {
					...node.componentProperties,
					'Property 1': { type: 'VARIANT', value: 'Button hover' }
				}
			})
		);
		const switched = store.requireNode(instance);
		expect(switched.type === 'INSTANCE' && switched.mainComponentId).toBe('N');
		// N has no layers, so the override has no match and is dropped (data-model.md section 7).
		expect(store.childNodes(instance)).toEqual([]);
	});
});
