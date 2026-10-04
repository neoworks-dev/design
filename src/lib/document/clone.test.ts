import { describe, expect, it } from 'vitest';
import { cloneSubtree } from './clone';
import { createNode } from './defaults';
import { buildDocument, frame, group, node, page, rectangle } from './fixtures';
import { sequentialIdGenerator } from './ids';
import { parseDesignDocument } from './schema';
import { DocumentStore } from './store';

function sampleStore(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page('P', [
				frame({ name: 'F' }, [
					rectangle({ name: 'R1', pluginData: { 'p.q': { a: 'b' } } }),
					group({ name: 'G' }, [rectangle({ name: 'R2' })])
				]),
				frame({ name: 'Next' })
			])
		])
	);
}

describe('cloneSubtree', () => {
	it('copies the whole subtree with fresh ids and consistent parents', () => {
		const store = sampleStore();
		const result = cloneSubtree(store, 'n2', { idGenerator: sequentialIdGenerator('c') });
		expect(result.nodes.map((created) => created.name)).toEqual(['F', 'R1', 'G', 'R2']);
		expect(result.nodes.map((created) => created.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
		const ids = new Set(result.nodes.map((created) => created.id));
		for (const created of result.nodes.slice(1)) expect(ids.has(created.parentId ?? '')).toBe(true);
		expect(result.nodes[0].parentId).toBe('n1');
	});

	it('places the clone right after the original and applies as ordinary changes', () => {
		const store = sampleStore();
		const result = cloneSubtree(store, 'n2');
		store.applyAll(result.changes);
		const order = store.childNodes('n1').map((child) => child.id);
		expect(order).toEqual(['n2', result.rootId, 'n6']);
		expect(parseDesignDocument(store.document).ok).toBe(true);
		expect(store.descendants(result.rootId)).toHaveLength(3);
	});

	it('honours an explicit parent and index', () => {
		const store = sampleStore();
		const result = cloneSubtree(store, 'n3', { parentId: 'n6', index: 'a0' });
		expect(result.nodes[0]).toMatchObject({ parentId: 'n6', index: 'a0' });
	});

	it('deep-copies: editing the clone does not touch the original', () => {
		const store = sampleStore();
		const result = cloneSubtree(store, 'n2');
		result.nodes[1].pluginData['p.q'].a = 'changed';
		expect(store.requireNode('n3').pluginData['p.q'].a).toBe('b');
	});

	it('remaps references that point inside the subtree and keeps outside ones', () => {
		const main = createNode('COMPONENT', { id: 'main', parentId: 'n1', index: 'a5' });
		const inner = createNode('RECTANGLE', { id: 'inner', parentId: 'main', index: 'a0' });
		const outside = createNode('COMPONENT', { id: 'outside', parentId: 'n1', index: 'a6' });
		const instance = createNode('INSTANCE', {
			id: 'inst',
			parentId: 'main',
			index: 'a1',
			mainComponentId: 'outside',
			reactions: [
				{
					trigger: { type: 'ON_CLICK' },
					actions: [{ type: 'NODE', destinationId: 'inner', navigation: 'NAVIGATE' }]
				}
			]
		});
		const instanceChild = createNode('RECTANGLE', {
			id: 'inst-child',
			parentId: 'inst',
			index: 'a0',
			componentRef: 'inner'
		});
		const store = sampleStore();
		store.applyAll(
			[main, inner, outside, instance, instanceChild].map((added) => ({
				t: 'add' as const,
				node: added
			}))
		);
		const result = cloneSubtree(store, 'main', { idGenerator: sequentialIdGenerator('c') });
		const clonedInstance = result.nodes.find((created) => created.name === 'Instance');
		const clonedChild = result.nodes.find(
			(created) => created.parentId === result.idMap.get('inst')
		);
		expect(clonedInstance).toMatchObject({ mainComponentId: 'outside' });
		expect(
			clonedInstance?.type === 'INSTANCE' && clonedInstance.reactions[0].actions[0]
		).toMatchObject({
			destinationId: result.idMap.get('inner')
		});
		expect(clonedChild).toMatchObject({ componentRef: result.idMap.get('inner') });
	});

	it('remaps a page flow starting point and an instance of a cloned main', () => {
		const store = new DocumentStore(
			buildDocument([
				page('P', [frame({ id: 'start' }), node('COMPONENT', { id: 'm' })], {
					flowStartingPoints: [{ nodeId: 'start', name: 'Flow' }]
				})
			])
		);
		const result = cloneSubtree(store, 'n1', {
			parentId: null,
			idGenerator: sequentialIdGenerator('c')
		});
		const clonedPage = result.nodes[0];
		expect(clonedPage.type === 'PAGE' && clonedPage.flowStartingPoints[0].nodeId).toBe(
			result.idMap.get('start')
		);
	});
});
