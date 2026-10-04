import { describe, expect, it } from 'vitest';
import type { DocumentStore, Effect, Paint } from '../document';
import { frame, group, node, page, rectangle, text } from '../document/fixtures';
import { exportCss } from './css';
import { applyTo, at, storeOf } from './fixtures/editingFixture';
import { copyProperties, planPasteProperties } from './properties';
import { exportSvg } from './svg';

function solid(r: number, g: number, b: number, opacity = 1): Paint {
	return { type: 'SOLID', visible: true, opacity, blendMode: 'NORMAL', color: { r, g, b } };
}

function shapes(): DocumentStore {
	return storeOf([
		page(
			'P',
			[
				rectangle({
					id: 'red',
					name: 'Red',
					transform: at(50, 20),
					width: 100,
					height: 40,
					cornerRadius: 8,
					fills: [solid(1, 0, 0)],
					strokes: [
						{
							paints: [solid(0, 0, 0)],
							weight: 2,
							align: 'CENTER',
							cap: 'NONE',
							join: 'MITER',
							miterLimit: 4,
							dashPattern: []
						}
					],
					opacity: 0.5
				}),
				rectangle({
					id: 'blue',
					name: 'Blue',
					transform: at(200, 100),
					width: 20,
					height: 20,
					fills: [solid(0, 0, 1)]
				})
			],
			{ id: 'p' }
		)
	]);
}

describe('exportSvg', () => {
	it('draws the selection relative to its top-left with fill, stroke, radius and opacity', () => {
		const svg = exportSvg(shapes(), ['red']);
		expect(svg).toContain('width="100" height="40" viewBox="0 0 100 40"');
		expect(svg).toContain(
			'<g id="red" data-name="Red" transform="matrix(1 0 0 1 0 0)" opacity="0.5">'
		);
		expect(svg).toContain(
			'<rect width="100" height="40" rx="8" ry="8" fill="#ff0000" fill-opacity="1" stroke="none"/>'
		);
		expect(svg).toContain('stroke="#000000"');
		expect(svg).toContain('stroke-width="2"');
	});

	it('positions several nodes relative to their common corner, bottom first', () => {
		const svg = exportSvg(shapes(), ['blue', 'red']) ?? '';
		expect(svg).toContain('viewBox="0 0 170 100"');
		expect(svg.indexOf('id="red"')).toBeLessThan(svg.indexOf('id="blue"'));
		expect(svg).toContain('id="blue" data-name="Blue" transform="matrix(1 0 0 1 150 80)"');
	});

	it('escapes names and skips hidden nodes and nothing selected', () => {
		const store = storeOf([
			page('P', [rectangle({ id: 'a', name: 'A "&" <B>', visible: false, width: 5, height: 5 })], {
				id: 'p'
			})
		]);
		expect(exportSvg(store, ['a'])).toBe(
			'<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5" viewBox="0 0 5 5" fill="none"/>'
		);
		expect(exportSvg(store, [])).toBeNull();
	});

	it('exports groups, frames with clipping, text, ellipses, stars, vectors and effects', () => {
		const shadow: Effect = {
			type: 'DROP_SHADOW',
			visible: true,
			color: { r: 0, g: 0, b: 0, a: 0.25 },
			offset: { x: 0, y: 4 },
			radius: 8,
			spread: 0,
			blendMode: 'NORMAL'
		};
		const store = storeOf([
			page(
				'P',
				[
					frame(
						{
							id: 'f',
							name: 'F',
							width: 100,
							height: 100,
							clipsContent: true,
							fills: [solid(1, 1, 1)]
						},
						[
							group({ id: 'g', name: 'G', width: 50, height: 50 }, [
								node('ELLIPSE', {
									id: 'e',
									name: 'E',
									width: 20,
									height: 10,
									fills: [solid(0, 1, 0)],
									effects: [shadow]
								}),
								node('STAR', {
									id: 's',
									name: 'S',
									width: 30,
									height: 30,
									pointCount: 5,
									innerRadius: 0.5,
									fills: [solid(0, 0, 0)]
								})
							]),
							text({ id: 't', name: 'T', width: 40, height: 20 }),
							node('VECTOR', {
								id: 'v',
								name: 'V',
								width: 10,
								height: 10,
								fills: [solid(0, 0, 0)],
								network: {
									vertices: [
										{ x: 0, y: 0 },
										{ x: 10, y: 0 },
										{ x: 10, y: 10 }
									],
									segments: [
										{ start: 0, end: 1 },
										{ start: 1, end: 2, tangentStart: { x: 0, y: 5 }, tangentEnd: { x: 0, y: -5 } },
										{ start: 2, end: 0 }
									],
									regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }]
								}
							})
						]
					)
				],
				{ id: 'p' }
			)
		]);
		const svg = exportSvg(store, ['f']) ?? '';
		expect(svg).toContain('<clipPath id="clip1">');
		expect(svg).toContain('clip-path="url(#clip1)"');
		expect(svg).toContain('<ellipse cx="10" cy="5" rx="10" ry="5"');
		expect(svg).toContain('<feDropShadow dx="0" dy="4" stdDeviation="4"');
		expect(svg).toContain('<polygon points="');
		expect(svg).toContain('<path d="M0 0 L10 0 C10 5 10 5 10 10 L0 0 Z"');
		expect(svg).toContain('<text font-family="Inter"');
	});

	it('wraps the siblings below a mask in a masked group and leaves the mask itself undrawn', () => {
		const store = storeOf([
			page(
				'P',
				[
					group({ id: 'g', name: 'G', width: 100, height: 100 }, [
						rectangle({
							id: 'below',
							name: 'Below',
							width: 100,
							height: 100,
							fills: [solid(1, 0, 0)]
						}),
						node('ELLIPSE', {
							id: 'mask',
							name: 'Mask',
							width: 50,
							height: 50,
							isMask: true,
							fills: [solid(0, 0, 1)]
						}),
						rectangle({
							id: 'above',
							name: 'Above',
							width: 10,
							height: 10,
							fills: [solid(0, 1, 0)]
						})
					])
				],
				{ id: 'p' }
			)
		]);
		const svg = exportSvg(store, ['g']) ?? '';
		expect(svg).toContain('<mask id="mask1" mask-type="alpha">');
		expect(svg).toContain('<g mask="url(#mask1)"><g id="below"');
		expect(svg).not.toContain('id="mask"');
		expect(svg.indexOf('id="above"')).toBeGreaterThan(svg.indexOf('mask="url(#mask1)"'));
		expect(svg).toContain('<ellipse cx="25" cy="25" rx="25" ry="25" fill="#ffffff"/>');
	});
});

describe('exportCss', () => {
	it('writes size, background, border, radius and opacity', () => {
		expect(exportCss(shapes(), ['red'])).toBe(
			[
				'width: 100px;',
				'height: 40px;',
				'background: #ff0000;',
				'border: 2px solid #000000;',
				'border-radius: 8px;',
				'opacity: 0.5;'
			].join('\n')
		);
	});

	it('titles each block by layer name when several are selected, and returns null for none', () => {
		const css = exportCss(shapes(), ['red', 'blue']) ?? '';
		expect(css.startsWith('/* Red */')).toBe(true);
		expect(css).toContain('/* Blue */');
		expect(exportCss(shapes(), [])).toBeNull();
	});

	it('writes auto layout as flexbox, shadows and blur, and the text style', () => {
		const store = storeOf([
			page(
				'P',
				[
					frame(
						{
							id: 'row',
							name: 'Row',
							width: 200,
							height: 50,
							layoutMode: 'HORIZONTAL',
							itemSpacing: 12,
							paddingTop: 4,
							paddingRight: 8,
							paddingBottom: 4,
							paddingLeft: 8,
							primaryAxisAlignItems: 'SPACE_BETWEEN',
							counterAxisAlignItems: 'CENTER',
							effects: [
								{
									type: 'DROP_SHADOW',
									visible: true,
									color: { r: 0, g: 0, b: 0, a: 0.25 },
									offset: { x: 0, y: 4 },
									radius: 8,
									spread: 2,
									blendMode: 'NORMAL'
								},
								{ type: 'LAYER_BLUR', visible: true, radius: 8 }
							]
						},
						[text({ id: 'label', name: 'Label', width: 40, height: 20 })]
					)
				],
				{ id: 'p' }
			)
		]);
		const css = exportCss(store, ['row']) ?? '';
		expect(css).toContain('display: flex;');
		expect(css).toContain('flex-direction: row;');
		expect(css).toContain('justify-content: space-between;');
		expect(css).toContain('align-items: center;');
		expect(css).toContain('gap: 12px;');
		expect(css).toContain('padding: 4px 8px 4px 8px;');
		expect(css).toContain('box-shadow: 0 4px 8px 2px rgba(0, 0, 0, 0.25);');
		expect(css).toContain('filter: blur(4px);');
		const label = exportCss(store, ['label']) ?? '';
		expect(label).toContain("font-family: 'Inter';");
		expect(label).toContain('font-size: 16px;');
		expect(label).toContain('color: #000000;');
	});
});

describe('copy and paste properties', () => {
	it('applies fills, strokes, opacity and radius to the targets in one change list', () => {
		const store = shapes();
		const copied = copyProperties(store, ['red']);
		if (copied === null) throw new Error('nothing copied');
		const changes = planPasteProperties(store, ['blue'], copied);
		expect(changes).toHaveLength(1);
		applyTo(store, changes);
		expect(store.requireNode('blue')).toMatchObject({
			opacity: 0.5,
			cornerRadius: 8,
			fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
		});
		expect(Reflect.get(store.requireNode('blue'), 'strokes')).toHaveLength(1);
		expect(store.requireNode('blue')).toMatchObject({ width: 20, height: 20 });
	});

	it('gives targets only the properties they have and copies the text style between texts', () => {
		const store = storeOf([
			page(
				'P',
				[
					text({ id: 'big', name: 'Big', width: 40, height: 20 }),
					text({ id: 'small', name: 'Small', width: 40, height: 20 }),
					group({ id: 'g', name: 'G', width: 10, height: 10 }, []),
					rectangle({ id: 'r', name: 'R', fills: [solid(1, 0, 0)] })
				],
				{ id: 'p' }
			)
		]);
		const big = store.requireNode('big');
		if (big.type !== 'TEXT') throw new Error('not text');
		applyTo(store, [
			{
				t: 'set',
				id: 'big',
				set: { defaultStyle: { ...big.defaultStyle, fontSize: 48 } },
				prev: { defaultStyle: big.defaultStyle }
			}
		]);
		const copied = copyProperties(store, ['big']);
		if (copied === null) throw new Error('nothing copied');
		applyTo(store, planPasteProperties(store, ['small', 'g', 'r'], copied));
		const small = store.requireNode('small');
		expect(small.type === 'TEXT' && small.defaultStyle.fontSize).toBe(48);
		expect(store.requireNode('g')).not.toHaveProperty('fills');
		expect(store.requireNode('r')).not.toHaveProperty('defaultStyle');
		expect(copyProperties(store, [])).toBeNull();
	});
});
