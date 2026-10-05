import { describe, expect, it } from 'vitest';
import { DocumentStore, createNode } from '../../document';
import { buildDocument, frame, page, rectangle } from '../../document/fixtures';
import { hexToRgb, rgbToHex } from './color';
import { serializeTree, type TreeSource } from './serialize';
import { translateProps } from './translateProps';

function sourceOf(store: DocumentStore): TreeSource {
	return {
		get: (id) => store.getNode(id),
		children: (id) => store.children(id),
		resolved: (id) => store.requireNode(id)
	};
}

function wideDocument(): DocumentStore {
	const children = Array.from({ length: 10 }, (_, position) =>
		rectangle({ id: `r${position}`, name: `R${position}` })
	);
	return new DocumentStore(
		buildDocument([page('P', [frame({ id: 'f', name: 'F' }, children)], { id: 'p' })])
	);
}

describe('hex colors', () => {
	it('round-trip and accept short forms', () => {
		expect(hexToRgb('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
		expect(hexToRgb('0f0')).toEqual({ r: 0, g: 1, b: 0 });
		expect(rgbToHex(hexToRgb('#12ab9f'))).toBe('#12ab9f');
	});

	it('refuse anything else with a message that shows the expected form', () => {
		expect(() => hexToRgb('red')).toThrow('hex color');
	});
});

describe('serializeTree', () => {
	it('stops at the node budget, marks the cut and says how to continue', () => {
		const tree = serializeTree(sourceOf(wideDocument()), 'f', { budget: 4 });
		const children = tree.children as unknown[];
		expect(children).toHaveLength(3);
		expect(tree.truncated).toBe('7 more children; read_tree nodeId=f');
		expect(tree.childCount).toBe(10);
	});

	it('limits the depth but still reports child counts', () => {
		const tree = serializeTree(sourceOf(wideDocument()), 'p', { depth: 1 });
		const [first] = tree.children as Record<string, unknown>[];
		expect(first.children).toBeUndefined();
		expect(first.childCount).toBe(10);
	});

	it('names positions relative to the parent and omits defaults', () => {
		const store = wideDocument();
		const tree = serializeTree(sourceOf(store), 'r0', {});
		expect(tree).toEqual({
			id: 'r0',
			type: 'RECTANGLE',
			name: 'R0',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			childCount: 0
		});
	});
});

describe('translateProps', () => {
	const blank = createNode('RECTANGLE', { id: 'x' });

	it('maps Figma-like names to node properties', () => {
		const result = translateProps(
			{ x: 5, y: 6, fill: '#000', stroke: '#fff', strokeWeight: 2, padding: 8, name: 'A' },
			blank
		);
		expect(result.transform).toEqual([
			[1, 0, 5],
			[0, 1, 6]
		]);
		expect(result.name).toBe('A');
		expect(result.paddingTop).toBe(8);
		expect(result.fills).toMatchObject([{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]);
		expect(result.strokes).toMatchObject([{ weight: 2, align: 'INSIDE' }]);
	});

	it('keeps the other axis when only x is given', () => {
		const moved = createNode('RECTANGLE', {
			id: 'm',
			transform: [
				[1, 0, 10],
				[0, 1, 20]
			]
		});
		expect(translateProps({ x: 99 }, moved).transform).toEqual([
			[1, 0, 99],
			[0, 1, 20]
		]);
	});

	it('refuses unknown properties and lists the supported ones', () => {
		expect(() => translateProps({ colour: 'red' }, blank)).toThrow(
			/unknown property: colour.*Supported/
		);
	});

	it('refuses a stroke weight without a stroke', () => {
		expect(() => translateProps({ strokeWeight: 3 }, blank)).toThrow('needs a stroke color');
	});
});
