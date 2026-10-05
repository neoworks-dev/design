import { describe, expect, it } from 'vitest';
import { sequentialIdGenerator, type Matrix2x3, type Node } from '../../document';
import { convertSnapshot, spreadStops, type ConvertOptions, type ConvertResult } from './convert';
import { BLACK, element, font, text, WHITE } from './fixtures';
import type { ElementSnapshot, NodeSnapshot } from './snapshot';

function convert(roots: ElementSnapshot[], options: Partial<ConvertOptions> = {}): ConvertResult {
	return convertSnapshot(
		{ roots, warnings: [], hiddenIds: [] },
		{ parentId: 'page', origin: { x: 0, y: 0 }, generateId: sequentialIdGenerator('n'), ...options }
	);
}

function byName(nodes: Node[], name: string): Node {
	const node = nodes.find((candidate) => candidate.name === name);
	if (node === undefined) throw new Error(`no node named ${name}`);
	return node;
}

function transformOf(node: Node): Matrix2x3 {
	if (!('transform' in node)) throw new Error(`${node.id} has no transform`);
	return node.transform;
}

describe('html snapshot to nodes', () => {
	it('turns a flex row into horizontal auto layout, border included in the padding', () => {
		const child = (name: string, x: number): NodeSnapshot =>
			element([x, 21, 40, 40], {
				attributes: { 'data-name': name },
				sizing: { width: 'fixed', height: 'fixed' }
			});
		const row = element([0, 0, 200, 82], {
			attributes: { 'data-name': 'Row' },
			style: {
				display: 'flex',
				columnGap: 8,
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: { top: 20, right: 20, bottom: 20, left: 20 },
				borderWidth: { top: 1, right: 1, bottom: 1, left: 1 },
				borderStyle: 'solid',
				borderColor: BLACK
			},
			children: [child('A', 21), child('B', 69)]
		});
		const { nodes, rootIds } = convert([row]);
		const frame = byName(nodes, 'Row');
		expect(rootIds).toEqual([frame.id]);
		expect(frame).toMatchObject({
			type: 'FRAME',
			parentId: 'page',
			layoutMode: 'HORIZONTAL',
			itemSpacing: 8,
			primaryAxisAlignItems: 'SPACE_BETWEEN',
			counterAxisAlignItems: 'CENTER',
			paddingTop: 21,
			paddingLeft: 21,
			clipsContent: false,
			strokes: [{ weight: 1, align: 'INSIDE' }]
		});
		expect(byName(nodes, 'A')).toMatchObject({ type: 'RECTANGLE', parentId: frame.id });
		expect(transformOf(byName(nodes, 'B'))).toEqual([
			[1, 0, 69],
			[0, 1, 21]
		]);
	});

	it('maps measured sizing: grow and stretch fill, content-sized hugs', () => {
		const label = element([0, 0, 50, 20], {
			attributes: { 'data-name': 'Label' },
			text: text('Hi', [0, 0, 50, 20]),
			sizing: { width: 'hug', height: 'hug' }
		});
		const grow = element([50, 0, 150, 20], {
			attributes: { 'data-name': 'Grow' },
			style: { flexGrow: 1 },
			children: [element([50, 0, 10, 10])]
		});
		const row = element([0, 0, 200, 20], { style: { display: 'flex' }, children: [label, grow] });
		const { nodes } = convert([row]);
		expect(byName(nodes, 'Label')).toMatchObject({
			type: 'TEXT',
			textAutoResize: 'WIDTH_AND_HEIGHT',
			layoutSizingHorizontal: 'HUG'
		});
		expect(byName(nodes, 'Grow')).toMatchObject({ layoutSizingHorizontal: 'FILL' });
	});

	it('makes inline text one text layer with styled runs', () => {
		const paragraph = element([0, 0, 300, 20], {
			sizing: { width: 'fill', height: 'hug' },
			text: {
				box: { x: 0, y: 0, width: 120, height: 20 },
				lines: 1,
				paragraphs: [
					[
						{ text: 'Hello ', font: font() },
						{ text: 'world', font: font({ weight: 700 }) }
					]
				]
			}
		});
		const { nodes } = convert([paragraph]);
		const layer = nodes[0];
		expect(layer.type).toBe('TEXT');
		if (layer.type !== 'TEXT') return;
		expect(layer.defaultStyle.fontName).toEqual({ family: 'Geist', style: 'Regular' });
		expect(layer.paragraphs[0].runs).toEqual([
			{ text: 'Hello ', style: {} },
			{ text: 'world', style: { fontName: { family: 'Geist', style: 'Bold' }, fontWeight: 700 } }
		]);
		expect(layer.textAutoResize).toBe('HEIGHT');
	});

	it('puts a decorated text element in a frame around a text layer', () => {
		const button = element([0, 0, 120, 40], {
			tag: 'button',
			sizing: { width: 'hug', height: 'hug' },
			style: {
				background: { r: 0.3, g: 0.3, b: 0.9, a: 1 },
				padding: { top: 10, right: 16, bottom: 10, left: 16 },
				radii: [8, 8, 8, 8],
				textAlign: 'center'
			},
			text: text('Sign in', [16, 10, 88, 20])
		});
		const { nodes } = convert([button]);
		expect(nodes[0]).toMatchObject({
			type: 'FRAME',
			name: 'Sign in',
			layoutMode: 'HORIZONTAL',
			primaryAxisAlignItems: 'CENTER',
			counterAxisAlignItems: 'CENTER',
			paddingLeft: 16,
			cornerRadius: 8,
			fills: [{ type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.9 } }]
		});
		expect(nodes[1]).toMatchObject({
			type: 'TEXT',
			parentId: nodes[0].id,
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
	});

	it('turns evenly stacked block children into vertical auto layout', () => {
		const card = element([0, 0, 200, 100], {
			attributes: { 'data-name': 'Card' },
			style: { padding: { top: 10, right: 10, bottom: 10, left: 10 } },
			sizing: { width: 'fixed', height: 'hug' },
			children: [
				element([10, 10, 180, 20], { sizing: { width: 'fill', height: 'fixed' } }),
				element([10, 40, 180, 20], { sizing: { width: 'fill', height: 'fixed' } }),
				element([10, 70, 180, 20], { sizing: { width: 'fill', height: 'fixed' } })
			]
		});
		const { nodes, warnings } = convert([card]);
		expect(byName(nodes, 'Card')).toMatchObject({
			layoutMode: 'VERTICAL',
			itemSpacing: 10,
			paddingTop: 10,
			paddingBottom: 10,
			paddingLeft: 10,
			paddingRight: 10,
			layoutSizingVertical: 'HUG',
			primaryAxisSizingMode: 'AUTO'
		});
		expect(
			nodes
				.filter((node) => node.type === 'RECTANGLE')
				.every((node) => 'layoutSizingHorizontal' in node && node.layoutSizingHorizontal === 'FILL')
		).toBe(true);
		expect(warnings).toEqual([]);
	});

	it('keeps unevenly spaced block children where they are, and says so', () => {
		const card = element([0, 0, 200, 100], {
			attributes: { 'data-name': 'Card' },
			children: [element([0, 0, 200, 20]), element([0, 30, 200, 20]), element([0, 80, 200, 20])]
		});
		const { nodes, warnings } = convert([card]);
		expect(byName(nodes, 'Card')).toMatchObject({ layoutMode: 'NONE' });
		expect(transformOf(nodes[3])).toEqual([
			[1, 0, 0],
			[0, 1, 80]
		]);
		expect(warnings[0]).toMatch(/uneven spacing/);
	});

	it('draws round leaves as ellipses and others as rounded rectangles', () => {
		const dot = element([0, 0, 10, 10], { style: { radii: [5, 5, 5, 5], background: WHITE } });
		const pill = element([20, 0, 40, 10], { style: { radii: [4, 4, 0, 0], background: WHITE } });
		const { nodes } = convert([dot, pill]);
		expect(nodes[0].type).toBe('ELLIPSE');
		expect(nodes[1]).toMatchObject({ type: 'RECTANGLE', cornerRadius: [4, 4, 0, 0] });
	});

	it('binds var() values to the variables of the file', () => {
		const box = element([0, 0, 100, 100], {
			style: { display: 'flex', background: WHITE, columnGap: 8 },
			variables: { 'background-color': '--surface', 'column-gap': '--space-2', color: '--missing' },
			children: [element([0, 0, 10, 10])]
		});
		const { nodes, warnings } = convert([box], {
			variables: { '--surface': 'VariableID:1', '--space-2': 'VariableID:2' }
		});
		const frame = nodes[0];
		if (frame.type !== 'FRAME') throw new Error('expected a frame');
		expect(frame.fills[0]).toMatchObject({
			boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'VariableID:1' } }
		});
		expect(frame.boundVariables).toEqual({
			itemSpacing: { type: 'VARIABLE_ALIAS', id: 'VariableID:2' }
		});
		expect(warnings).toEqual([]);
	});

	it('places roots from the origin and keeps their relative positions', () => {
		const { nodes, idsByDataId } = convert(
			[element([10, 10, 50, 50], { attributes: { 'data-id': 'a' } }), element([100, 10, 50, 50])],
			{ origin: { x: 500, y: 200 } }
		);
		expect(transformOf(nodes[0])).toEqual([
			[1, 0, 500],
			[0, 1, 200]
		]);
		expect(transformOf(nodes[1])).toEqual([
			[1, 0, 590],
			[0, 1, 200]
		]);
		expect(idsByDataId).toEqual({ a: nodes[0].id });
	});

	it('spreads open gradient stops and converts pixel positions', () => {
		const stops = spreadStops(
			[
				{ color: BLACK, position: null },
				{ color: BLACK, position: null },
				{ color: BLACK, position: { value: 50, unit: 'px' } },
				{ color: BLACK, position: null }
			],
			100
		);
		expect(stops.map((stop) => stop.position)).toEqual([0, 0.25, 0.5, 1]);
	});
});
