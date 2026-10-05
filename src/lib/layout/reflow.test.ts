import { describe, expect, it } from 'vitest';
import {
	applyChanges,
	createNode,
	DocumentStore,
	type Change,
	type Node,
	type TextNode
} from '../document';
import { buildDocument, frame, page, rectangle, text } from '../document/fixtures';
import type { LayoutNodeSource } from './build';
import { findLayoutRoots, planReflow } from './reflow';
import { sizingProps } from './sizing';
import { fakeText } from './testing';

function at(x: number, y: number): [[number, number, number], [number, number, number]] {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

function plain(node: TextNode): string {
	return node.paragraphs[0].runs.map((run) => run.text).join('');
}

function store(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page('P', [
				frame(
					{
						id: 'outer',
						layoutMode: 'VERTICAL',
						layoutSizingHorizontal: 'HUG',
						layoutSizingVertical: 'HUG'
					},
					[
						frame(
							{
								id: 'inner',
								layoutMode: 'HORIZONTAL',
								layoutSizingHorizontal: 'HUG',
								layoutSizingVertical: 'HUG'
							},
							[rectangle({ id: 'a', width: 10, height: 10, transform: at(5, 5) })]
						),
						frame({ id: 'plain', width: 50, height: 50 }, [rectangle({ id: 'deep' })])
					]
				),
				frame({ id: 'lonely', width: 10, height: 10 }, [rectangle({ id: 'x' })]),
				text({ id: 't', textAutoResize: 'WIDTH_AND_HEIGHT' })
			])
		])
	);
}

function sourceOf(documentStore: DocumentStore): LayoutNodeSource {
	return {
		node: (id) => documentStore.requireNode(id),
		children: (id) => documentStore.children(id),
		measureText: (node, width) => fakeText(plain(node as TextNode))(width)
	};
}

function set(id: string, props: Record<string, unknown>, documentStore: DocumentStore): Change {
	const node = documentStore.requireNode(id);
	const prev: Record<string, unknown> = {};
	for (const key of Object.keys(props)) prev[key] = Reflect.get(node, key);
	return { t: 'set', id, set: props, prev };
}

describe('findLayoutRoots', () => {
	it('climbs from any touched member to the outermost stack', () => {
		const documentStore = store();
		const reader = documentStore;
		expect(findLayoutRoots(reader, [set('a', { width: 20 }, documentStore)])).toEqual(['outer']);
		expect(findLayoutRoots(reader, [set('inner', { itemSpacing: 4 }, documentStore)])).toEqual([
			'outer'
		]);
		expect(findLayoutRoots(reader, [set('outer', { itemSpacing: 4 }, documentStore)])).toEqual([
			'outer'
		]);
	});

	it('ignores changes outside auto layout and properties that do not move anything', () => {
		const documentStore = store();
		expect(findLayoutRoots(documentStore, [set('lonely', { width: 20 }, documentStore)])).toEqual(
			[]
		);
		expect(findLayoutRoots(documentStore, [set('deep', { width: 20 }, documentStore)])).toEqual([]);
		expect(findLayoutRoots(documentStore, [set('a', { name: 'x' }, documentStore)])).toEqual([]);
	});

	it('knows about children that were added, deleted and moved', () => {
		const documentStore = store();
		const added = createNode('RECTANGLE', { id: 'n', parentId: 'inner', index: 'zz' });
		expect(findLayoutRoots(documentStore, [{ t: 'add', node: added as Node }])).toEqual(['outer']);
		const removed = documentStore.requireNode('a');
		expect(findLayoutRoots(documentStore, [{ t: 'del', node: removed }])).toEqual(['outer']);
		expect(
			findLayoutRoots(documentStore, [
				{ t: 'move', id: 'x', parent: 'inner', index: 'a', prevParent: 'lonely', prevIndex: 'a' }
			])
		).toEqual(['outer']);
	});
});

describe('planReflow', () => {
	it('lays out nested stacks and reaches a fixed point', () => {
		const documentStore = store();
		const first = planReflow(documentStore, sourceOf(documentStore), 'outer');
		expect(first.length).toBeGreaterThan(0);
		applyChanges(documentStore, first);
		expect(documentStore.requireNode('a')).toMatchObject({
			transform: [
				[1, 0, 0],
				[0, 1, 0]
			]
		});
		expect(documentStore.requireNode('inner')).toMatchObject({ width: 10, height: 10 });
		expect(documentStore.requireNode('plain')).toMatchObject({ width: 50, height: 50 });
		expect(documentStore.requireNode('outer')).toMatchObject({ width: 50, height: 60 });
		expect(planReflow(documentStore, sourceOf(documentStore), 'outer')).toEqual([]);
	});

	it('mirrors hug and fixed into the axis sizing modes', () => {
		const documentStore = store();
		applyChanges(documentStore, planReflow(documentStore, sourceOf(documentStore), 'outer'));
		expect(documentStore.requireNode('outer')).toMatchObject({
			primaryAxisSizingMode: 'AUTO',
			counterAxisSizingMode: 'AUTO'
		});
		applyChanges(documentStore, [set('outer', { layoutSizingVertical: 'FIXED' }, documentStore)]);
		applyChanges(documentStore, planReflow(documentStore, sourceOf(documentStore), 'outer'));
		expect(documentStore.requireNode('outer')).toMatchObject({
			primaryAxisSizingMode: 'FIXED',
			counterAxisSizingMode: 'AUTO'
		});
	});
});

describe('sizingProps', () => {
	it('writes just the sizing for shapes and frames', () => {
		const documentStore = store();
		expect(sizingProps(documentStore.requireNode('a'), 'horizontal', 'FILL')).toEqual({
			layoutSizingHorizontal: 'FILL'
		});
	});

	it('keeps text auto resize in step', () => {
		const documentStore = store();
		const label = documentStore.requireNode('t');
		expect(sizingProps(label, 'horizontal', 'FILL')).toEqual({
			layoutSizingHorizontal: 'FILL',
			textAutoResize: 'HEIGHT'
		});
		expect(sizingProps(label, 'vertical', 'FIXED')).toEqual({
			layoutSizingVertical: 'FIXED',
			textAutoResize: 'NONE'
		});
		expect(sizingProps(label, 'horizontal', 'HUG')).toMatchObject({
			textAutoResize: 'WIDTH_AND_HEIGHT',
			layoutSizingVertical: 'HUG'
		});
	});
});
