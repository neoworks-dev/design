import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyChanges, ComponentCycleError, InvalidChangeError } from './apply';
import {
	planEntityAdd,
	planEntitySet,
	planInsert,
	planMoveNode,
	planRemove,
	planSetProps
} from './changes';
import { createNode } from './defaults';
import { buildDocument, frame, group, page, rectangle, type NodeSpec } from './fixtures';
import { DocumentStore, invertChanges } from './store';
import type { Change, Node, Variable } from './types';

// n1 page A: n2 frame F1 (n3 R1, n4 R2, n5 group G (n6 R3)), n7 frame F2 ; n8 page B
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

function snapshot(store: DocumentStore): string {
	const ids = Object.keys(store.nodes).sort();
	const order = [null, ...ids].map((id) => [id, [...store.children(id)]]);
	const nodes = ids.map((id) => store.nodes[id]);
	return JSON.stringify({ ...store.document, nodes, order });
}

describe('applyChanges normalization', () => {
	it('re-reads prev values and del snapshots from the real state', () => {
		const store = sampleStore();
		const applied = applyChanges(store, [
			{ t: 'set', id: 'n3', set: { name: 'renamed' }, prev: { name: 'a lie' } },
			{ t: 'del', node: createNode('RECTANGLE', { id: 'n4', name: 'forged snapshot' }) }
		]);
		expect(applied[0]).toMatchObject({ prev: { name: 'R1' } });
		expect(applied[1]).toMatchObject({ t: 'del', node: { name: 'R2', parentId: 'n2' } });
		expect(store.hasNode('n4')).toBe(false);
	});

	it('records an absent key as undefined so the inverse removes it again', () => {
		const store = sampleStore();
		const before = snapshot(store);
		const applied = applyChanges(store, [
			{ t: 'set', id: 'n3', set: { touched: ['fills'] }, prev: {} }
		]);
		expect(applied[0]).toMatchObject({ prev: { touched: undefined } });
		applyChanges(store, invertChanges(applied));
		expect(snapshot(store)).toBe(before);
	});
});

describe('applyChanges rejection is atomic', () => {
	it('leaves the store untouched when a later change is invalid', () => {
		const store = sampleStore();
		const before = snapshot(store);
		const changes: Change[] = [
			...planSetProps(store, 'n3', { name: 'ok' }),
			...planSetProps(store, 'n4', { name: 'also ok' }),
			{ t: 'set', id: 'n3', set: { opacity: 7 }, prev: {} }
		];
		expect(() => applyChanges(store, changes)).toThrow(InvalidChangeError);
		expect(snapshot(store)).toBe(before);
	});

	it.each([
		['unknown node', (): Change => ({ t: 'set', id: 'nope', set: { name: 'x' }, prev: {} })],
		['protected key', (): Change => ({ t: 'set', id: 'n3', set: { parentId: 'n7' }, prev: {} })],
		['schema violation', (): Change => ({ t: 'set', id: 'n3', set: { visible: 'yes' }, prev: {} })],
		[
			'unknown property',
			(): Change => ({ t: 'set', id: 'n3', set: { notAProperty: 1 }, prev: {} })
		],
		[
			'child of a rectangle',
			(): Change => ({
				t: 'add',
				node: createNode('RECTANGLE', { id: 'x', parentId: 'n3', index: 'a0' })
			})
		],
		[
			'child of a missing parent',
			(): Change => ({
				t: 'add',
				node: createNode('RECTANGLE', { id: 'x', parentId: 'ghost', index: 'a0' })
			})
		],
		[
			'non-page root',
			(): Change => ({
				t: 'add',
				node: createNode('RECTANGLE', { id: 'x', parentId: null, index: 'a0' })
			})
		],
		['move into own subtree', (): Change => planMoveNode(sampleStore(), 'n2', 'n6', 0)[0]],
		[
			'deleting a node that still has children',
			(): Change => ({ t: 'del', node: createNode('FRAME', { id: 'n2' }) })
		],
		[
			'duplicate id',
			(): Change => ({
				t: 'add',
				node: createNode('RECTANGLE', { id: 'n3', parentId: 'n2', index: 'a5' })
			})
		]
	])('rejects %s and changes nothing', (_name, build) => {
		const store = sampleStore();
		const before = snapshot(store);
		expect(() =>
			applyChanges(store, [...planSetProps(store, 'n7', { name: 'x' }), build()])
		).toThrow();
		expect(snapshot(store)).toBe(before);
	});

	it('rejects an entity that fails its schema', () => {
		const store = sampleStore();
		const bad = { id: 'v1', name: 'x' } as unknown as Variable;
		expect(() => applyChanges(store, planEntityAdd('variable', bad))).toThrow(InvalidChangeError);
		expect(Object.keys(store.document.variables)).toEqual([]);
	});
});

describe('component cycles (data-model.md section 7)', () => {
	// page P: component M (rect inside), component N (instance of M inside), frame F
	function componentStore(): DocumentStore {
		const store = new DocumentStore(
			buildDocument([
				page('P', [
					frame({ name: 'F' }),
					node('COMPONENT', { id: 'M', name: 'M' }),
					node('COMPONENT', { id: 'N', name: 'N' })
				])
			])
		);
		return store;
	}
	function node(type: 'COMPONENT', props: Record<string, unknown>): NodeSpec {
		return { type, props, children: [] };
	}
	const pageId = 'n1';

	function instance(id: string, parentId: string, mainComponentId: string): Node {
		return createNode('INSTANCE', { id, parentId, index: 'a0', mainComponentId });
	}

	it('rejects an instance of M inside M', () => {
		const store = componentStore();
		const before = snapshot(store);
		expect(() => applyChanges(store, planInsert(instance('i', 'M', 'M')))).toThrow(
			ComponentCycleError
		);
		expect(snapshot(store)).toBe(before);
	});

	it('rejects the cycle through a nested instance', () => {
		const store = componentStore();
		applyChanges(store, planInsert(instance('iM', 'N', 'M')));
		const before = snapshot(store);
		// N contains an instance of M; an instance of N inside M closes the loop.
		expect(() => applyChanges(store, planInsert(instance('iN', 'M', 'N')))).toThrow(
			ComponentCycleError
		);
		expect(snapshot(store)).toBe(before);
	});

	it('rejects moving an instance subtree into its own main', () => {
		const store = componentStore();
		applyChanges(store, [...planInsert(instance('iM', 'n2', 'M'))]);
		const before = snapshot(store);
		expect(() => applyChanges(store, planMoveNode(store, 'n2', 'M', 0))).toThrow(
			ComponentCycleError
		);
		expect(snapshot(store)).toBe(before);
	});

	it('rejects re-pointing an instance at a main that would contain it', () => {
		const store = componentStore();
		applyChanges(store, planInsert(instance('iX', 'M', 'N')));
		const before = snapshot(store);
		expect(() => applyChanges(store, planSetProps(store, 'iX', { mainComponentId: 'M' }))).toThrow(
			ComponentCycleError
		);
		expect(snapshot(store)).toBe(before);
	});

	it('allows an instance of M outside M and rejects a main that is not a component', () => {
		const store = componentStore();
		expect(() => applyChanges(store, planInsert(instance('ok', 'n2', 'M')))).not.toThrow();
		expect(() => applyChanges(store, planInsert(instance('bad', 'n2', pageId)))).toThrow(
			InvalidChangeError
		);
	});
});

// A random edit sequence interpreted against the live store.
type Edit =
	| { kind: 'insert'; target: number; position: number }
	| { kind: 'rename'; target: number; name: string }
	| { kind: 'opacity'; target: number; opacity: number }
	| { kind: 'move'; target: number; destination: number; position: number }
	| { kind: 'remove'; target: number };

const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
	fc.record({ kind: fc.constant('insert' as const), target: fc.nat(40), position: fc.nat(5) }),
	fc.record({ kind: fc.constant('rename' as const), target: fc.nat(40), name: fc.string() }),
	fc.record({
		kind: fc.constant('opacity' as const),
		target: fc.nat(40),
		opacity: fc.double({ min: 0, max: 1, noNaN: true })
	}),
	fc.record({
		kind: fc.constant('move' as const),
		target: fc.nat(40),
		destination: fc.nat(40),
		position: fc.nat(5)
	}),
	fc.record({ kind: fc.constant('remove' as const), target: fc.nat(40) })
);

function buildChanges(store: DocumentStore, edit: Edit, counter: number): Change[] {
	const ids = Object.keys(store.nodes);
	const target = ids[edit.target % ids.length];
	const node = store.requireNode(target);
	switch (edit.kind) {
		case 'insert': {
			if (node.type === 'RECTANGLE') return [];
			const created = createNode('RECTANGLE', {
				id: `new${counter}`,
				parentId: node.id,
				index: `${'a'.repeat(1 + (counter % 3))}${counter}`
			});
			return planInsert(created);
		}
		case 'rename':
			return planSetProps(store, target, { name: edit.name });
		case 'opacity': {
			if (node.type === 'PAGE') return [];
			return planSetProps(store, target, { opacity: edit.opacity });
		}
		case 'move':
			return planMoveNode(store, target, ids[edit.destination % ids.length], edit.position);
		case 'remove':
			return planRemove(store, target);
	}
}

describe('undo round trip (property)', () => {
	it('applying then the inverse restores a structurally identical document', () => {
		fc.assert(
			fc.property(fc.array(editArbitrary, { maxLength: 30 }), (edits) => {
				const store = sampleStore();
				const initial = snapshot(store);
				const undoStack: Change[][] = [];
				edits.forEach((edit, counter) => {
					let changes: Change[];
					try {
						changes = buildChanges(store, edit, counter);
					} catch {
						return;
					}
					const before = snapshot(store);
					try {
						undoStack.push(invertChanges(applyChanges(store, changes)));
					} catch {
						expect(snapshot(store)).toBe(before);
					}
				});
				while (undoStack.length > 0) {
					const undo = undoStack.pop();
					if (undo) applyChanges(store, undo);
				}
				expect(snapshot(store)).toBe(initial);
			}),
			{ numRuns: 200 }
		);
	});

	it('round trips entity changes', () => {
		const store = sampleStore();
		const before = snapshot(store);
		const variable: Variable = {
			id: 'v1',
			name: 'brand',
			collectionId: 'c1',
			resolvedType: 'FLOAT',
			valuesByMode: { m1: 4 },
			scopes: [],
			codeSyntax: {},
			description: ''
		};
		const added = applyChanges(store, planEntityAdd('variable', variable));
		const edited = applyChanges(store, planEntitySet(store, 'variable', 'v1', { name: 'accent' }));
		expect(store.getEntity('variable', 'v1')?.name).toBe('accent');
		applyChanges(store, invertChanges(edited));
		applyChanges(store, invertChanges(added));
		expect(snapshot(store)).toBe(before);
	});
});
