import { describe, expect, it } from 'vitest';
import { createNode, type Node, type SolidPaint } from '../document';
import { MIXED, isSameValue, readProperty, summarizeSelection } from './selection';

function solid(red: number): SolidPaint[] {
	return [
		{ type: 'SOLID', color: { r: red, g: 0, b: 0 }, opacity: 1, visible: true, blendMode: 'NORMAL' }
	];
}

describe('summarizeSelection', () => {
	it('describes an empty selection', () => {
		expect(summarizeSelection([])).toEqual({
			count: 0,
			kinds: [],
			kind: 'none',
			sharedParent: false,
			parentId: null,
			hasInstance: false,
			hasComponent: false,
			hasText: false
		});
	});

	it('describes a single node and its parent', () => {
		const rectangle = createNode('RECTANGLE', { id: 'r', parentId: 'p' });
		expect(summarizeSelection([rectangle])).toMatchObject({
			count: 1,
			kind: 'RECTANGLE',
			sharedParent: true,
			parentId: 'p'
		});
	});

	it('reports mixed kinds, a shared parent and text', () => {
		const nodes = [
			createNode('TEXT', { id: 'a', parentId: 'p' }),
			createNode('RECTANGLE', { id: 'b', parentId: 'p' })
		];
		expect(summarizeSelection(nodes)).toMatchObject({
			count: 2,
			kinds: ['TEXT', 'RECTANGLE'],
			kind: 'mixed',
			sharedParent: true,
			hasText: true,
			hasInstance: false
		});
	});

	it('knows when nodes have different parents', () => {
		const nodes = [
			createNode('FRAME', { id: 'a', parentId: 'p1' }),
			createNode('FRAME', { id: 'b', parentId: 'p2' })
		];
		expect(summarizeSelection(nodes)).toMatchObject({
			kind: 'FRAME',
			sharedParent: false,
			parentId: null
		});
	});

	it('flags instances and main components', () => {
		const instance = createNode('INSTANCE', { id: 'i', parentId: 'p' });
		const component = createNode('COMPONENT', { id: 'c', parentId: 'p' });
		const set = createNode('COMPONENT_SET', { id: 's', parentId: 'p' });
		expect(summarizeSelection([instance])).toMatchObject({
			hasInstance: true,
			hasComponent: false
		});
		expect(summarizeSelection([component])).toMatchObject({ hasComponent: true });
		expect(summarizeSelection([set])).toMatchObject({ hasComponent: true });
	});

	it('a page has no parent, so it never counts as a shared parent', () => {
		const pageNode = createNode('PAGE', { id: 'pg' });
		expect(summarizeSelection([pageNode]).sharedParent).toBe(false);
	});
});

describe('readProperty', () => {
	const a = createNode('RECTANGLE', { id: 'a', opacity: 0.5, name: 'A' });
	const b = createNode('RECTANGLE', { id: 'b', opacity: 0.5, name: 'B' });
	const c = createNode('RECTANGLE', { id: 'c', opacity: 1, name: 'C' });

	it('returns undefined for no nodes', () => {
		expect(readProperty([], (node) => node.id)).toBeUndefined();
	});

	it('returns the value of a single node', () => {
		expect(readProperty([a], (node) => (node.type === 'RECTANGLE' ? node.opacity : 0))).toBe(0.5);
	});

	it('returns the shared value when all nodes agree', () => {
		expect(readProperty([a, b], (node) => (node.type === 'RECTANGLE' ? node.opacity : 0))).toBe(
			0.5
		);
	});

	it('returns MIXED for diverging values', () => {
		expect(readProperty([a, b, c], (node) => (node.type === 'RECTANGLE' ? node.opacity : 0))).toBe(
			MIXED
		);
		expect(readProperty([a, b], (node) => node.name)).toBe(MIXED);
	});

	it('compares structured values by content, not identity', () => {
		const withFills = (id: string, red: number): Node =>
			createNode('RECTANGLE', { id, fills: solid(red) });
		const read = (node: Node): unknown => {
			if (node.type === 'RECTANGLE') return node.fills;
			return undefined;
		};
		expect(readProperty([withFills('x', 1), withFills('y', 1)], read)).toEqual(solid(1));
		expect(readProperty([withFills('x', 1), withFills('y', 0.5)], read)).toBe(MIXED);
	});
});

describe('isSameValue', () => {
	it('treats NaN as equal to itself and distinguishes arrays from objects', () => {
		expect(isSameValue(Number.NaN, Number.NaN)).toBe(true);
		expect(isSameValue([], {})).toBe(false);
		expect(isSameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
		expect(isSameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(isSameValue(null, {})).toBe(false);
	});
});
