import { describe, expect, it } from 'vitest';
import { DocumentStore, sequentialIdGenerator, type Node, type NodeId } from '../../document';
import { buildDocument, frame, group, node, page, rectangle, text } from '../../document/fixtures';
import { convertSnapshot } from './convert';
import { element, text as textSnapshot } from './fixtures';
import { nearlyEqual, planReconcile, type ReconcilePlan } from './reconcile';
import type { ElementSnapshot } from './snapshot';

function store(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page(
				'Page',
				[
					frame(
						{ id: 'card', name: 'Card', width: 200, height: 100, pluginData: { p: { k: 'v' } } },
						[
							rectangle({ id: 'a', name: 'A', width: 50, height: 50 }),
							rectangle({ id: 'b', name: 'B', width: 50, height: 50 }),
							text({ id: 'label', name: 'Label' })
						]
					),
					group({ id: 'group', name: 'Group' }, [rectangle({ id: 'inside', name: 'Inside' })]),
					node('VECTOR', { id: 'icon', name: 'Icon' })
				],
				{ id: 'page' }
			)
		])
	);
}

function replace(
	reader: DocumentStore,
	id: NodeId,
	root: ElementSnapshot,
	hiddenIds: string[] = []
): ReconcilePlan {
	const replaced = [reader.requireNode(id), ...reader.descendants(id)];
	const converted = convertSnapshot(
		{ roots: [root], warnings: [], hiddenIds },
		{
			parentId: reader.requireNode(id).parentId ?? 'page',
			origin: { x: 0, y: 0 },
			generateId: sequentialIdGenerator('new'),
			reuseIds: new Set(replaced.map((existing) => existing.id))
		}
	);
	return planReconcile({
		reader,
		nodes: converted.nodes,
		rootIds: converted.rootIds,
		target: { kind: 'replace', id },
		hiddenIds,
		generateId: sequentialIdGenerator('fresh')
	});
}

function box(id: string, x: number, name: string): ElementSnapshot {
	return element([x, 0, 50, 50], { attributes: { 'data-id': id, 'data-name': name } });
}

function setOf(plan: ReconcilePlan, id: NodeId): Record<string, unknown> | undefined {
	return plan.sets.find((set) => set.id === id)?.props;
}

describe('reconcile', () => {
	it('sets only what changed and keeps what HTML cannot say', () => {
		const reader = store();
		const root = element([0, 0, 200, 100], {
			attributes: { 'data-id': 'card', 'data-name': 'Card' },
			children: [box('a', 0, 'A'), box('b', 60, 'Renamed')]
		});
		const plan = replace(reader, 'card', root);
		expect(plan.rootIds).toEqual(['card']);
		expect(setOf(plan, 'b')).toMatchObject({ name: 'Renamed' });
		expect(setOf(plan, 'card')?.pluginData).toBeUndefined();
		expect(plan.removes).toEqual(['label']);
		expect(plan.adds).toEqual([]);
	});

	it('keeps sibling indexes when the order did not change, and moves on a reorder', () => {
		const reader = store();
		const same = replace(
			reader,
			'card',
			element([0, 0, 200, 100], {
				attributes: { 'data-id': 'card', 'data-name': 'Card' },
				children: [box('a', 0, 'A'), box('b', 60, 'B'), box('new', 120, 'New')]
			})
		);
		expect(same.moves).toEqual([]);
		const added = same.adds[0];
		expect(added.index > reader.requireNode('b').index).toBe(true);
		const swapped = replace(
			reader,
			'card',
			element([0, 0, 200, 100], {
				attributes: { 'data-id': 'card', 'data-name': 'Card' },
				children: [box('b', 0, 'B'), box('a', 60, 'A')]
			})
		);
		expect(swapped.moves.map((move) => move.id)).toEqual(['a']);
		expect(swapped.moves[0].index > reader.requireNode('b').index).toBe(true);
	});

	it('keeps a group a group and a vector untouched', () => {
		const reader = store();
		const groupPlan = replace(
			reader,
			'group',
			element([0, 0, 50, 50], {
				attributes: { 'data-id': 'group', 'data-name': 'Grouped' },
				children: [box('inside', 0, 'Inside')]
			})
		);
		expect(setOf(groupPlan, 'group')).toMatchObject({ name: 'Grouped' });
		expect(setOf(groupPlan, 'group')?.fills).toBeUndefined();
		expect(groupPlan.adds).toEqual([]);
		const vectorPlan = replace(
			reader,
			'icon',
			element([0, 0, 24, 24], {
				attributes: { 'data-id': 'icon', 'data-name': 'Changed' },
				children: [box('x', 0, 'Drawn')]
			})
		);
		expect(vectorPlan.sets).toEqual([]);
		expect(vectorPlan.adds).toEqual([]);
		expect(vectorPlan.removes).toEqual([]);
	});

	it('gives an incompatible layer a new id and removes the old one', () => {
		const reader = store();
		const plan = replace(
			reader,
			'card',
			element([0, 0, 200, 100], {
				attributes: { 'data-id': 'card', 'data-name': 'Card' },
				children: [
					box('a', 0, 'A'),
					box('b', 60, 'B'),
					element([0, 60, 50, 50], {
						attributes: { 'data-id': 'label', 'data-name': 'Was text' },
						children: [box('deep', 0, 'Deep')]
					})
				]
			})
		);
		const added = plan.adds.map((added: Node) => added.id);
		expect(added).toContain('fresh1');
		expect(plan.removes).toEqual(['label']);
		const child = plan.adds.find((added) => added.name === 'Deep');
		expect(child?.parentId).toBe('fresh1');
	});

	it('never removes layers the HTML hid', () => {
		const reader = store();
		const plan = replace(
			reader,
			'card',
			element([0, 0, 200, 100], {
				attributes: { 'data-id': 'card', 'data-name': 'Card' },
				children: [box('a', 0, 'A')]
			}),
			['label']
		);
		expect(plan.removes).toEqual(['b']);
	});

	it('takes new text but not the same text with rounded style values', () => {
		const reader = store();
		const original = reader.requireNode('label');
		if (original.type !== 'TEXT') throw new Error('expected text');
		const same = element([0, 60, 100, 20], {
			attributes: { 'data-id': 'label', 'data-name': 'Label' },
			sizing: { width: 'hug', height: 'hug' },
			text: textSnapshot(original.paragraphs[0].runs[0]?.text ?? '', [0, 60, 100, 20])
		});
		const changed = { ...same, text: textSnapshot('Other words', [0, 60, 100, 20]) };
		const children = [box('a', 0, 'A'), box('b', 60, 'B')];
		const card = (label: ElementSnapshot): ElementSnapshot =>
			element([0, 0, 200, 100], {
				attributes: { 'data-id': 'card', 'data-name': 'Card' },
				children: [...children, label]
			});
		expect(setOf(replace(reader, 'card', card(changed)), 'label')?.paragraphs).toBeDefined();
	});
});

describe('nearly equal', () => {
	it('ignores 8-bit colour rounding and two-decimal pixels, not real changes', () => {
		expect(nearlyEqual({ r: 0.1234, g: 0.5 }, { r: 31 / 255, g: 0.5 })).toBe(true);
		expect(nearlyEqual(12.004, 12)).toBe(true);
		expect(nearlyEqual(12.3, 12)).toBe(false);
		expect(nearlyEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(nearlyEqual({ a: undefined }, {})).toBe(true);
	});
});
