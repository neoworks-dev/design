import { describe, expect, it } from 'vitest';
import { applyChanges, ComponentCycleError, rollback } from './apply';
import { planRemove, planSetProps } from './changes';
import {
	addInstance,
	applyWithSync,
	BLUE,
	childByName,
	get,
	ids,
	paragraphs,
	RED,
	snapshot,
	storeWithMain,
	tail
} from './componentHarness';
import {
	planCreateInstance,
	planDetach,
	planPushOverrides,
	planResetOverrides,
	planRestoreMain
} from './componentOps';
import { planSwap } from './componentSwap';
import { createNode } from './defaults';
import { sequentialIdGenerator } from './ids';
import type { DocumentStore } from './store';
import type { Node, NodeId, TouchedGroup } from './types';

describe('building an instance', () => {
	it('copies the tree with componentRef per node and mainComponentId on the root', () => {
		const store = storeWithMain();
		const rootId = addInstance(store);
		const root = store.requireNode(rootId);
		expect(root.type).toBe('INSTANCE');
		if (root.type !== 'INSTANCE') return;
		expect(root.mainComponentId).toBe('M');
		expect(root.componentRef).toBeUndefined();
		expect(store.parentOf(rootId)?.id).toBe('p');
		const copies = store.childNodes(rootId);
		expect(copies.map((copy) => copy.componentRef)).toEqual(['bg', 'label']);
		expect(copies.map((copy) => copy.touched)).toEqual([[], []]);
		expect(copies.map((copy) => copy.name)).toEqual(['bg', 'label']);
		expect(new Set([rootId, ...copies.map((copy) => copy.id)]).size).toBe(3);
	});

	it('places the instance beside the main', () => {
		const store = storeWithMain();
		const root = store.requireNode(addInstance(store));
		if (root.type === 'PAGE') return;
		expect(root.transform[0][2]).toBeGreaterThan(100);
	});
});

interface GroupCase {
	group: TouchedGroup;
	node: 'bg' | 'label' | 'M';
	/** What the instance sets itself. */
	override: Record<string, unknown>;
	/** What the main changes to afterwards. */
	mainEdit: Record<string, unknown>;
}

const BLUR = (radius: number): unknown => ({ type: 'LAYER_BLUR', visible: true, radius });
const STROKE = (weight: number): unknown => ({
	paints: [...RED],
	weight,
	align: 'INSIDE',
	cap: 'NONE',
	join: 'MITER',
	miterLimit: 4,
	dashPattern: []
});
const REACTION = (url: string): unknown => ({
	trigger: { type: 'ON_CLICK' },
	actions: [{ type: 'URL', url }]
});

const GROUP_CASES: GroupCase[] = [
	{ group: 'name', node: 'bg', override: { name: 'Mine' }, mainEdit: { name: 'Theirs' } },
	{ group: 'visibility', node: 'bg', override: { visible: false }, mainEdit: { locked: true } },
	{ group: 'geometry', node: 'bg', override: { width: 60 }, mainEdit: { width: 45 } },
	{ group: 'corners', node: 'bg', override: { cornerRadius: 8 }, mainEdit: { cornerRadius: 3 } },
	{ group: 'fills', node: 'bg', override: { fills: [...BLUE] }, mainEdit: { fills: [] } },
	{
		group: 'strokes',
		node: 'bg',
		override: { strokes: [STROKE(2)] },
		mainEdit: { strokes: [STROKE(5)] }
	},
	{
		group: 'effects',
		node: 'bg',
		override: { effects: [BLUR(4)] },
		mainEdit: { effects: [BLUR(9)] }
	},
	{ group: 'blend', node: 'bg', override: { opacity: 0.5 }, mainEdit: { opacity: 0.25 } },
	{ group: 'auto-layout', node: 'M', override: { itemSpacing: 12 }, mainEdit: { itemSpacing: 20 } },
	{
		group: 'text-content',
		node: 'label',
		override: { paragraphs: paragraphs('World') },
		mainEdit: { paragraphs: paragraphs('Changed in main') }
	},
	{
		group: 'text-style',
		node: 'label',
		override: { textTruncation: 'ENDING' },
		mainEdit: { textTruncation: 'DISABLED', maxLines: 2 }
	},
	{
		group: 'prototype',
		node: 'bg',
		override: { reactions: [REACTION('https://a.test')] },
		mainEdit: { reactions: [REACTION('https://b.test')] }
	},
	{
		group: 'plugin-data',
		node: 'bg',
		override: { pluginData: { me: { a: 'mine' } } },
		mainEdit: { pluginData: { me: { a: 'main' } } }
	}
];

function counterpartIn(
	store: DocumentStore,
	instanceId: NodeId,
	nodeName: GroupCase['node']
): Node {
	if (nodeName === 'M') return store.requireNode(instanceId);
	const found = store.childNodes(instanceId).find((child) => child.componentRef === nodeName);
	if (found === undefined) throw new Error(`no copy of ${nodeName}`);
	return found;
}

describe('propagation per touched group', () => {
	for (const testCase of GROUP_CASES) {
		it(`${testCase.group}: untouched instance follows the main, touched one keeps its override`, () => {
			const store = storeWithMain();
			const generate = ids();
			const untouched = addInstance(store, 'M', generate);
			const overridden = addInstance(store, 'M', generate);

			const copy = counterpartIn(store, overridden, testCase.node);
			applyWithSync(store, planSetProps(store, copy.id, testCase.override));
			expect(counterpartIn(store, overridden, testCase.node).touched).toContain(testCase.group);
			expect(counterpartIn(store, untouched, testCase.node).touched).toEqual([]);

			applyWithSync(store, planSetProps(store, testCase.node, testCase.mainEdit));

			const followed = counterpartIn(store, untouched, testCase.node);
			for (const [key, value] of Object.entries(testCase.mainEdit)) {
				expect(Reflect.get(followed, key), key).toEqual(value);
			}
			const kept = counterpartIn(store, overridden, testCase.node);
			for (const [key, value] of Object.entries(testCase.override)) {
				expect(Reflect.get(kept, key), key).toEqual(value);
			}
		});
	}
});

describe('root properties an instance owns', () => {
	it('never copies the main position or hides the instance', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const before = get(store, instance);
		applyWithSync(
			store,
			planSetProps(store, 'M', {
				transform: [
					[1, 0, 500],
					[0, 1, 500]
				],
				visible: false
			})
		);
		expect(Reflect.get(store.requireNode(instance), 'transform')).toEqual(
			Reflect.get(before, 'transform')
		);
		expect(Reflect.get(store.requireNode(instance), 'visible')).toBe(true);
	});

	it('does not mark root position edits as overrides', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		applyWithSync(
			store,
			planSetProps(store, instance, {
				transform: [
					[1, 0, 9],
					[0, 1, 9]
				]
			})
		);
		expect(store.requireNode(instance).touched).toEqual([]);
	});
});

describe('undo', () => {
	it('reverts a main edit and every instance update in one step', () => {
		const store = storeWithMain();
		const generate = ids();
		addInstance(store, 'M', generate);
		addInstance(store, 'M', generate);
		const before = snapshot(store);
		const applied = applyWithSync(
			store,
			planSetProps(store, 'bg', { fills: [...BLUE], width: 33 })
		);
		expect(applied.length).toBeGreaterThan(1);
		expect(snapshot(store)).not.toBe(before);
		rollback(store, applied);
		expect(snapshot(store)).toBe(before);
	});

	it('replays without syncing twice', () => {
		const store = storeWithMain();
		addInstance(store);
		const applied = applyWithSync(store, planSetProps(store, 'bg', { width: 70 }));
		const after = snapshot(store);
		rollback(store, applied);
		applyWithSync(store, applied, { replay: true });
		expect(snapshot(store)).toBe(after);
	});
});

describe('structure', () => {
	it('adds a layer added to the main to every instance', () => {
		const store = storeWithMain();
		const generate = ids();
		const first = addInstance(store, 'M', generate);
		const second = addInstance(store, 'M', generate);
		const added = createNode('RECTANGLE', {
			id: 'extra',
			name: 'extra',
			parentId: 'M',
			index: tail(store, 'M')
		});
		applyWithSync(store, [{ t: 'add', node: added }], { ids: generate });
		for (const instance of [first, second]) {
			const copy = childByName(store, instance, 'extra');
			expect(copy.componentRef).toBe('extra');
		}
	});

	it('copies a layer added with its children once, children following their parent', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const box = createNode('FRAME', {
			id: 'box',
			name: 'box',
			parentId: 'M',
			index: tail(store, 'M')
		});
		const inner = createNode('RECTANGLE', {
			id: 'inner',
			name: 'inner',
			parentId: 'box',
			index: 'a0'
		});
		applyWithSync(store, [
			{ t: 'add', node: box },
			{ t: 'add', node: inner }
		]);
		const boxCopy = childByName(store, instance, 'box');
		expect(store.childNodes(boxCopy.id).map((child) => child.componentRef)).toEqual(['inner']);
	});

	it('removes copies of a deleted layer', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		applyWithSync(store, planRemove(store, 'bg'));
		expect(store.childNodes(instance).map((child) => child.name)).toEqual(['label']);
	});

	it('mirrors a reorder of layers in the main', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		applyWithSync(store, [
			{
				t: 'move',
				id: 'bg',
				parent: 'M',
				index: tail(store, 'M'),
				prevParent: 'M',
				prevIndex: store.requireNode('bg').index
			}
		]);
		expect(store.childNodes(instance).map((child) => child.name)).toEqual(['label', 'bg']);
	});

	it('leaves layers added inside an instance alone', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const local = createNode('RECTANGLE', {
			id: 'local',
			name: 'local',
			parentId: instance,
			index: tail(store, instance)
		});
		applyWithSync(store, [{ t: 'add', node: local }]);
		applyWithSync(store, planSetProps(store, 'bg', { width: 12 }));
		expect(store.childNodes(instance).map((child) => child.name)).toEqual(['bg', 'label', 'local']);
	});
});

describe('nested instances', () => {
	function nestedStore(): { store: DocumentStore; outer: string; inner: string } {
		const store = storeWithMain();
		// M1 contains an instance of M.
		const holder = createNode('COMPONENT', {
			id: 'M1',
			name: 'Card',
			parentId: 'p',
			index: tail(store, 'p'),
			width: 200,
			height: 100
		});
		applyChanges(store, [{ t: 'add', node: holder }]);
		const inner = planCreateInstance(store, 'M', {
			parentId: 'M1',
			index: 'a0',
			idGenerator: sequentialIdGenerator('in')
		});
		applyChanges(store, inner.changes);
		const outer = planCreateInstance(store, 'M1', { idGenerator: sequentialIdGenerator('out') });
		applyChanges(store, outer.changes);
		return { store, outer: outer.rootId, inner: inner.rootId };
	}

	it('chains counterparts: nested copy points at the node it was copied from', () => {
		const { store, outer, inner } = nestedStore();
		const nested = store.childNodes(outer)[0];
		expect(nested.type).toBe('INSTANCE');
		expect(nested.componentRef).toBe(inner);
		const nestedLeaf = store.childNodes(nested.id)[0];
		const innerLeaf = store.childNodes(inner)[0];
		expect(nestedLeaf.componentRef).toBe(innerLeaf.id);
		expect(innerLeaf.componentRef).toBe('bg');
	});

	it('propagates an edit of the innermost main through both levels', () => {
		const { store, outer } = nestedStore();
		applyWithSync(store, planSetProps(store, 'bg', { width: 11 }));
		const nested = store.childNodes(outer)[0];
		expect(Reflect.get(store.childNodes(nested.id)[0], 'width')).toBe(11);
	});

	it('stops at the level that overrode the group', () => {
		const { store, outer, inner } = nestedStore();
		const innerLeaf = store.childNodes(inner)[0];
		applyWithSync(store, planSetProps(store, innerLeaf.id, { width: 77 }));
		expect(Reflect.get(store.childNodes(store.childNodes(outer)[0].id)[0], 'width')).toBe(77);
		applyWithSync(store, planSetProps(store, 'bg', { width: 11 }));
		expect(Reflect.get(store.requireNode(innerLeaf.id), 'width')).toBe(77);
		expect(Reflect.get(store.childNodes(store.childNodes(outer)[0].id)[0], 'width')).toBe(77);
	});
});

describe('reset, push, detach', () => {
	it('reset clears touched groups and takes the main values again', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const copy = childByName(store, instance, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { width: 5, fills: [...BLUE] }));
		expect(store.requireNode(copy.id).touched?.sort()).toEqual(['fills', 'geometry']);
		applyWithSync(store, planResetOverrides(store, [instance]));
		const reset = store.requireNode(copy.id);
		expect(reset.touched).toEqual([]);
		expect(Reflect.get(reset, 'width')).toBe(100);
		expect(Reflect.get(reset, 'fills')).toEqual(RED);
	});

	it('reset then main edit syncs again', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const copy = childByName(store, instance, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { width: 5 }));
		applyWithSync(store, planResetOverrides(store, [copy.id]));
		applyWithSync(store, planSetProps(store, 'bg', { width: 61 }));
		expect(Reflect.get(store.requireNode(copy.id), 'width')).toBe(61);
	});

	it('push writes the override into the main and the other instances follow', () => {
		const store = storeWithMain();
		const generate = ids();
		const pushing = addInstance(store, 'M', generate);
		const other = addInstance(store, 'M', generate);
		const copy = childByName(store, pushing, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { fills: [...BLUE] }));
		applyWithSync(store, planPushOverrides(store, [pushing]));
		expect(Reflect.get(store.requireNode('bg'), 'fills')).toEqual(BLUE);
		expect(Reflect.get(childByName(store, other, 'bg'), 'fills')).toEqual(BLUE);
		expect(store.requireNode(copy.id).touched).toEqual([]);
	});

	it('detach turns the instance into a frame and drops every link', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const plan = planDetach(store, [instance], sequentialIdGenerator('d'));
		applyWithSync(store, plan.changes);
		const frameId = plan.frameIds.get(instance);
		if (frameId === undefined) throw new Error('no frame');
		expect(store.hasNode(instance)).toBe(false);
		const detached = store.requireNode(frameId);
		expect(detached.type).toBe('FRAME');
		expect(detached.componentRef).toBeUndefined();
		for (const child of store.childNodes(frameId)) {
			expect(child.componentRef).toBeUndefined();
			expect(child.touched).toBeUndefined();
		}
		applyWithSync(store, planSetProps(store, 'bg', { width: 1 }));
		expect(Reflect.get(childByName(store, frameId, 'bg'), 'width')).toBe(100);
	});

	it('detach is one reversible change list', () => {
		const store = storeWithMain();
		const instance = addInstance(store);
		const before = snapshot(store);
		const applied = applyWithSync(
			store,
			planDetach(store, [instance], sequentialIdGenerator('d')).changes
		);
		rollback(store, applied);
		expect(snapshot(store)).toBe(before);
	});
});

describe('cycles', () => {
	it('rejects an instance of a component inside itself', () => {
		const store = storeWithMain();
		const plan = planCreateInstance(store, 'M', {
			parentId: 'M',
			index: tail(store, 'M'),
			idGenerator: ids()
		});
		const before = snapshot(store);
		expect(() => applyWithSync(store, plan.changes)).toThrow(ComponentCycleError);
		expect(snapshot(store)).toBe(before);
	});
});

describe('swap', () => {
	function twoMains(): DocumentStore {
		const store = storeWithMain();
		const other = createNode('COMPONENT', {
			id: 'N',
			name: 'Chip',
			parentId: 'p',
			index: tail(store, 'p'),
			width: 50,
			height: 20
		});
		const bg = createNode('RECTANGLE', { id: 'nbg', name: 'bg', parentId: 'N', index: 'a0' });
		const label = createNode('TEXT', { id: 'nlabel', name: 'label', parentId: 'N', index: 'a1' });
		applyChanges(store, [
			{ t: 'add', node: other },
			{ t: 'add', node: bg },
			{ t: 'add', node: label }
		]);
		return store;
	}

	it('keeps id and place, links to the new main and carries overrides by name path', () => {
		const store = twoMains();
		const instance = addInstance(store);
		const copy = childByName(store, instance, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { fills: [...BLUE] }));
		const changes = planSwap(store, instance, 'N', sequentialIdGenerator('s'));
		applyWithSync(store, changes);
		const swapped = store.requireNode(instance);
		expect(swapped.type === 'INSTANCE' && swapped.mainComponentId).toBe('N');
		const swappedBg = childByName(store, instance, 'bg');
		expect(swappedBg.componentRef).toBe('nbg');
		expect(Reflect.get(swappedBg, 'fills')).toEqual(BLUE);
		expect(swappedBg.touched).toEqual(['fills']);
		expect(childByName(store, instance, 'label').touched).toEqual([]);
	});

	it('drops overrides that have no match in the new main', () => {
		const store = twoMains();
		const instance = addInstance(store);
		const extra = createNode('RECTANGLE', {
			id: 'only',
			name: 'only',
			parentId: 'M',
			index: tail(store, 'M')
		});
		applyWithSync(store, [{ t: 'add', node: extra }], { ids: sequentialIdGenerator('x') });
		const copy = childByName(store, instance, 'only');
		applyWithSync(store, planSetProps(store, copy.id, { width: 4 }));
		applyWithSync(store, planSwap(store, instance, 'N', sequentialIdGenerator('s')));
		expect(store.childNodes(instance).map((child) => child.name)).toEqual(['bg', 'label']);
	});
});

describe('deleting a main', () => {
	it('leaves instances in place and restore rebuilds the main with the same ids', () => {
		const store = storeWithMain();
		const generate = ids();
		const first = addInstance(store, 'M', generate);
		const second = addInstance(store, 'M', generate);
		const copy = childByName(store, first, 'bg');
		applyWithSync(store, planSetProps(store, copy.id, { fills: [...BLUE] }));
		applyWithSync(store, planRemove(store, 'M'));
		expect(store.hasNode('M')).toBe(false);
		expect(store.hasNode(first)).toBe(true);
		expect(() =>
			applyWithSync(store, planSetProps(store, first, { name: 'still editable' }))
		).not.toThrow();

		const plan = planRestoreMain(store, first, generate);
		applyWithSync(store, plan.changes);
		expect(store.requireNode('M').type).toBe('COMPONENT');
		expect(store.childNodes('M').map((child) => child.id)).toEqual(['bg', 'label']);
		applyWithSync(store, planSetProps(store, 'label', { width: 31 }));
		expect(Reflect.get(childByName(store, second, 'label'), 'width')).toBe(31);
	});
});

describe('performance', () => {
	it('propagates a main edit to 500 instances within the budget', () => {
		const store = storeWithMain();
		const generate = ids();
		for (let count = 0; count < 500; count += 1) addInstance(store, 'M', generate);
		const started = performance.now();
		const applied = applyWithSync(store, planSetProps(store, 'bg', { width: 42 }));
		const elapsed = performance.now() - started;
		expect(applied.length).toBe(501);
		// Budget documented in docs/design/data-model.md: 500 instances in under 250 ms.
		expect(elapsed).toBeLessThan(250);
	});
});
