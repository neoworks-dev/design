import { describe, expect, it } from 'vitest';
import { applyChanges, rollback } from './apply';
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
import { planCreateInstance, planResetOverrides } from './componentOps';
import {
	planAddProperty,
	planDeleteProperty,
	planRenameProperty,
	planSetPropertyDefault
} from './componentProperties';
import { createNode } from './defaults';
import { plainText } from './text';
import type { DocumentStore } from './store';

function boolean(store: DocumentStore): void {
	const plan = planAddProperty(store, 'M', {
		name: 'Show label',
		type: 'BOOLEAN',
		defaultValue: true,
		layerIds: ['label']
	});
	applyWithSync(store, plan.changes);
}

describe('boolean and text properties', () => {
	it('toggling a boolean on an instance hides the bound layer and marks the override', () => {
		const store = storeWithMain();
		boolean(store);
		const instance = addInstance(store);
		const node = store.requireNode(instance);
		if (node.type !== 'INSTANCE') throw new Error('not an instance');
		expect(node.componentProperties['Show label']).toEqual({ type: 'BOOLEAN', value: true });
		const before = snapshot(store);

		const applied = applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: { 'Show label': { type: 'BOOLEAN', value: false } }
			})
		);
		const copy = childByName(store, instance, 'label');
		expect(Reflect.get(copy, 'visible')).toBe(false);
		expect(copy.touched).toEqual(['visibility']);
		rollback(store, applied);
		expect(snapshot(store)).toBe(before);
	});

	it('a main edit does not undo what a property drove', () => {
		const store = storeWithMain();
		boolean(store);
		const instance = addInstance(store);
		applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: { 'Show label': { type: 'BOOLEAN', value: false } }
			})
		);
		applyWithSync(store, planSetProps(store, 'label', { visible: true, opacity: 0.5 }));
		const copy = childByName(store, instance, 'label');
		expect(Reflect.get(copy, 'visible')).toBe(false);
		expect(Reflect.get(copy, 'opacity')).toBe(0.5);
	});

	it('a text property rewrites the bound layer, keeping its style', () => {
		const store = storeWithMain();
		const plan = planAddProperty(store, 'M', {
			name: 'Label',
			type: 'TEXT',
			defaultValue: 'Hello',
			layerIds: ['label']
		});
		applyWithSync(store, plan.changes);
		const instance = addInstance(store);
		applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: { Label: { type: 'TEXT', value: 'Buy now' } }
			})
		);
		const copy = childByName(store, instance, 'label');
		if (copy.type !== 'TEXT') throw new Error('not text');
		expect(plainText(copy.paragraphs)).toBe('Buy now');
		expect(copy.touched).toEqual(['text-content']);
	});

	it('reset overrides puts the properties and the bound layers back', () => {
		const store = storeWithMain();
		boolean(store);
		const instance = addInstance(store);
		applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: { 'Show label': { type: 'BOOLEAN', value: false } }
			})
		);
		applyWithSync(store, planResetOverrides(store, [instance]));
		const node = store.requireNode(instance);
		expect(node.type === 'INSTANCE' && node.componentProperties['Show label'].value).toBe(true);
		const copy = childByName(store, instance, 'label');
		expect(Reflect.get(copy, 'visible')).toBe(true);
		expect(copy.touched).toEqual([]);
	});

	it('a new instance after a changed default starts in that state', () => {
		const store = storeWithMain();
		boolean(store);
		applyWithSync(store, planSetPropertyDefault(store, 'M', 'Show label', false));
		expect(Reflect.get(store.requireNode('label'), 'visible')).toBe(false);
		const instance = addInstance(store);
		expect(Reflect.get(childByName(store, instance, 'label'), 'visible')).toBe(false);
	});
});

describe('renaming and deleting properties', () => {
	it('rename rewrites definition, bindings and instance values; delete removes them', () => {
		const store = storeWithMain();
		boolean(store);
		const instance = addInstance(store);
		const renamed = planRenameProperty(store, 'M', 'Show label', 'Visible');
		applyWithSync(store, renamed.changes);
		const main = store.requireNode('M');
		expect(main.type === 'COMPONENT' && Object.keys(main.componentPropertyDefinitions)).toEqual([
			'Visible'
		]);
		expect(store.requireNode('label').componentPropertyReferences).toEqual({ visible: 'Visible' });
		const node = store.requireNode(instance);
		expect(node.type === 'INSTANCE' && Object.keys(node.componentProperties)).toEqual(['Visible']);

		const before = snapshot(store);
		const applied = applyWithSync(store, planDeleteProperty(store, 'M', 'Visible'));
		expect(store.requireNode('label').componentPropertyReferences).toBeUndefined();
		const after = store.requireNode(instance);
		expect(after.type === 'INSTANCE' && after.componentProperties).toEqual({});
		rollback(store, applied);
		expect(snapshot(store)).toBe(before);
	});
});

describe('instance swap properties', () => {
	function storeWithIcons(): DocumentStore {
		const store = storeWithMain();
		for (const [id, size] of [
			['iconA', 10],
			['iconB', 20]
		] as const) {
			applyChanges(store, [
				{
					t: 'add',
					node: createNode('COMPONENT', {
						id,
						name: id,
						parentId: 'p',
						index: tail(store, 'p'),
						width: size,
						height: size
					})
				}
			]);
		}
		// A nested instance of iconA inside M, bound to an instance-swap property.
		const nested = planCreateInstance(store, 'iconA', {
			parentId: 'M',
			index: tail(store, 'M'),
			idGenerator: ids('n')
		});
		applyChanges(store, nested.changes);
		store.requireNode(nested.rootId);
		return store;
	}

	it('setting the property swaps the nested instance in the instance', () => {
		const store = storeWithIcons();
		const nestedId = store.childNodes('M').find((node) => node.type === 'INSTANCE')?.id;
		if (nestedId === undefined) throw new Error('no nested instance');
		applyWithSync(
			store,
			planAddProperty(store, 'M', {
				name: 'Icon',
				type: 'INSTANCE_SWAP',
				defaultValue: 'iconA',
				layerIds: [nestedId]
			}).changes
		);
		const instance = addInstance(store, 'M', ids('x'));
		const nestedCopy = store.childNodes(instance).find((node) => node.type === 'INSTANCE');
		if (nestedCopy === undefined || nestedCopy.type !== 'INSTANCE') throw new Error('no copy');
		expect(nestedCopy.mainComponentId).toBe('iconA');

		applyWithSync(
			store,
			planSetProps(store, instance, {
				componentProperties: { Icon: { type: 'INSTANCE_SWAP', value: 'iconB' } }
			}),
			{ ids: ids('y') }
		);
		const swapped = store.requireNode(nestedCopy.id);
		expect(swapped.type === 'INSTANCE' && swapped.mainComponentId).toBe('iconB');
		expect(swapped.componentRef).toBe(nestedId);
	});
});
