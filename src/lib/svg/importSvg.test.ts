// SVG import (#106): structure of the imported tree, and golden renders. The fixtures are small
// SVGs whose pixels at known points are known by construction; the nodes are put on a page and
// drawn headlessly with the real CanvasKit.

import { beforeAll, describe, expect, it } from 'vitest';
import { page } from '../document/fixtures';
import type { Node } from '../document/types';
import { applyTo, storeOf } from '../editing/fixtures/editingFixture';
import { loadCanvasKit, type CanvasKit } from '../renderer/canvaskit';
import { nodeWasmLocator } from '../renderer/canvaskit.node';
import { CanvasKitBackend } from '../renderer/canvaskitBackend';
import { DrawHookRegistry } from '../renderer/draw/hooks';
import { PaintShaderFactory } from '../renderer/draw/paintShaders';
import { SkiaTracker } from '../renderer/ownership';
import { StoreSceneSource } from '../renderer/storeSceneSource';
import { RenderSurface } from '../renderer/surface';
import { importSvg, type SvgImport } from './importSvg';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

const SIZE = 120;
const BACKGROUND: [number, number, number] = [245, 245, 245];

function svg(body: string, attributes = 'width="100" height="100"'): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
}

function imported(markup: string): SvgImport {
	const result = importSvg(markup);
	if (!result) throw new Error('not imported');
	return result;
}

function byType(result: SvgImport, type: Node['type']): Node[] {
	return result.nodes.filter((node) => node.type === type);
}

/** Render the import on an empty page and return a pixel reader. */
function render(result: SvgImport): (x: number, y: number) => [number, number, number] {
	const store = storeOf([page('P', [], { id: 'p' })]);
	const [frame, ...rest] = result.nodes;
	applyTo(
		store,
		[{ ...frame, parentId: 'p', index: 'a0' } as Node, ...rest].map((node) => ({
			t: 'add' as const,
			node
		}))
	);
	const tracker = new SkiaTracker();
	const surface = RenderSurface.offscreen(canvasKit, tracker, SIZE, SIZE);
	const factory = new PaintShaderFactory(canvasKit, tracker, {
		peek: () => undefined,
		status: () => 'missing'
	});
	const hooks = new DrawHookRegistry();
	hooks.register({
		shaderForPaint: (context, paint, size) => factory.shaderFor(context, paint, size)
	});
	new CanvasKitBackend(canvasKit, tracker, surface, hooks).render({
		source: new StoreSceneSource(store.document, { pageId: 'p' }),
		view: { x: 0, y: 0, scale: 1 },
		size: { width: SIZE, height: SIZE },
		devicePixelRatio: 1
	});
	return (x, y) => {
		const [red, green, blue] = surface.readPixels({ x, y, width: 1, height: 1 });
		return [red, green, blue];
	};
}

function expectColor(
	actual: [number, number, number],
	expected: [number, number, number],
	label: string
): void {
	for (let channel = 0; channel < 3; channel += 1) {
		expect(
			Math.abs(actual[channel] - expected[channel]),
			`${label}: ${actual.join(',')}`
		).toBeLessThanOrEqual(6);
	}
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const GREEN: [number, number, number] = [0, 128, 0];

describe('structure', () => {
	it('is a frame the size of the SVG holding the shapes, parents before children', () => {
		const result = imported(
			svg(
				'<g id="icon"><rect x="10" y="20" width="30" height="40" rx="5" fill="#f00"/><circle cx="70" cy="30" r="10" fill="blue"/></g><path d="M0 0 L10 0 L10 10 Z"/>'
			)
		);
		const [frame, ...rest] = result.nodes;
		expect(frame).toMatchObject({ type: 'FRAME', name: 'SVG', width: 100, height: 100 });
		expect(result.rootId).toBe(frame.id);
		const seen = new Set([frame.id]);
		for (const node of rest) {
			expect(seen.has(node.parentId ?? ''), `${node.name} comes after its parent`).toBe(true);
			seen.add(node.id);
		}
		expect(byType(result, 'GROUP')).toHaveLength(1);
		expect(byType(result, 'RECTANGLE')).toHaveLength(1);
		expect(byType(result, 'ELLIPSE')).toHaveLength(1);
		expect(byType(result, 'VECTOR')).toHaveLength(1);
		const group = byType(result, 'GROUP')[0];
		expect(group).toMatchObject({ name: 'icon', width: 70, height: 40 });
		const rectangle = byType(result, 'RECTANGLE')[0];
		if (rectangle.type !== 'RECTANGLE') throw new Error('not a rectangle');
		expect(rectangle.cornerRadius).toBe(5);
		expect(rectangle.parentId).toBe(group.id);
		expect(rectangle.transform[0][2]).toBe(0);
		expect(rectangle.transform[1][2]).toBe(0);
	});

	it('takes the frame size from the viewBox and scales the content to the width', () => {
		const result = imported(
			svg('<rect width="10" height="10"/>', 'viewBox="0 0 10 10" width="100" height="100"')
		);
		const [rectangle] = byType(result, 'RECTANGLE');
		expect(result.width).toBe(100);
		expect(rectangle).toMatchObject({ width: 10, height: 10 });
		expect(rectangle.type !== 'PAGE' && rectangle.transform[0][0]).toBe(10);
	});

	it('returns null for text that is not SVG', () => {
		expect(importSvg('hello world')).toBeNull();
		expect(importSvg('<html></html>')).toBeNull();
		expect(importSvg('<svg><unclosed></svg>')).toBeNull();
	});

	it('expands use, applies inherited styles and class rules', () => {
		const result = imported(
			svg(
				'<style>.r{fill:#00f}</style><defs><rect id="box" width="10" height="10" class="r"/></defs><g fill="red"><use href="#box" x="20" y="30"/></g>'
			)
		);
		const [rectangle] = byType(result, 'RECTANGLE');
		if (rectangle.type !== 'RECTANGLE') throw new Error('not a rectangle');
		expect(rectangle.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } });
	});

	it('reports what it cannot import and keeps the rest', () => {
		const result = imported(
			svg(
				'<defs><clipPath id="c"><rect width="5" height="5"/></clipPath><filter id="f"/></defs><image href="a.png" width="10" height="10"/><rect width="10" height="10" clip-path="url(#c)" filter="url(#f)"/><animate/>'
			)
		);
		expect(byType(result, 'RECTANGLE')).toHaveLength(1);
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				'images are not imported',
				'clip-path is not imported',
				'filter is not imported',
				'<animate> is not imported'
			])
		);
	});

	it('imports simple text as a text node with the SVG font settings', () => {
		const result = imported(
			svg(
				'<text x="10" y="40" font-family="Georgia, serif" font-size="20" font-weight="bold" fill="#f00">Hello <tspan>world</tspan></text>'
			)
		);
		const [text] = byType(result, 'TEXT');
		if (text.type !== 'TEXT') throw new Error('not text');
		expect(text.paragraphs[0].runs[0].text).toBe('Hello world');
		expect(text.defaultStyle).toMatchObject({
			fontSize: 20,
			fontName: { family: 'Georgia', style: 'Bold' }
		});
		expect(text.defaultStyle.fills[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
	});

	it('hides display:none elements', () => {
		const result = imported(
			svg(
				'<rect width="10" height="10" display="none"/><rect width="5" height="5" style="display:none"/>'
			)
		);
		expect(byType(result, 'RECTANGLE')).toHaveLength(0);
	});
});

describe('golden renders', () => {
	it('draws rectangles, circles and paths where the SVG puts them', () => {
		const pixel = render(
			imported(
				svg(
					'<rect x="10" y="10" width="30" height="30" fill="red"/><circle cx="70" cy="25" r="15" fill="blue"/><path d="M10 60 L50 60 L30 95 Z" fill="green"/>'
				)
			)
		);
		expectColor(pixel(25, 25), RED, 'rect');
		expectColor(pixel(70, 25), BLUE, 'circle centre');
		expectColor(pixel(95, 25), BACKGROUND, 'outside the circle');
		expectColor(pixel(30, 70), GREEN, 'triangle');
		expectColor(pixel(15, 90), BACKGROUND, 'outside the triangle');
	});

	it('scales a viewBox and bakes group and shape transforms', () => {
		const pixel = render(
			imported(
				svg(
					'<g transform="translate(5 5)"><rect width="10" height="10" fill="red" transform="translate(5 5)"/></g><rect x="30" y="30" width="10" height="10" fill="blue" transform="rotate(45 35 35)"/>',
					'viewBox="0 0 50 50" width="100" height="100"'
				)
			)
		);
		expectColor(pixel(30, 30), RED, 'translated rect (scale 2): 10..30 px');
		expectColor(pixel(5, 5), BACKGROUND, 'before it');
		expectColor(pixel(70, 70), BLUE, 'rotated square centre');
		expectColor(pixel(60, 70), BLUE, 'rotated square reaches 14px left of the centre');
		expectColor(pixel(61, 61), BACKGROUND, 'a corner of the unrotated square is empty');
	});

	it('draws strokes with weight, and fill rules', () => {
		const pixel = render(
			imported(
				svg(
					'<rect x="20" y="20" width="60" height="60" fill="none" stroke="red" stroke-width="10"/><path d="M0 0 H10 V10 H0 Z M3 3 H7 V7 H3 Z" fill="blue" fill-rule="evenodd" transform="translate(85 85)"/>'
				)
			)
		);
		expectColor(pixel(20, 50), RED, 'stroke centred on the edge');
		expectColor(pixel(50, 50), BACKGROUND, 'inside a rectangle with fill none');
		expectColor(pixel(87, 87), BLUE, 'evenodd ring');
		expectColor(pixel(90, 90), BACKGROUND, 'evenodd hole');
	});

	it('draws linear and radial gradients across the shape', () => {
		const pixel = render(
			imported(
				svg(
					'<defs><linearGradient id="l"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><radialGradient id="r"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect x="0" y="0" width="100" height="40" fill="url(#l)"/><rect x="0" y="50" width="50" height="50" fill="url(#r)"/>'
				)
			)
		);
		expectColor(pixel(2, 20), [250, 0, 5], 'left end is red');
		expectColor(pixel(97, 20), [8, 0, 247], 'right end is blue');
		expectColor(pixel(50, 20), [128, 0, 128], 'middle is mixed');
		expectColor(pixel(25, 75), [250, 250, 250], 'radial centre is white');
		const [edge] = pixel(25, 52);
		expect(edge).toBeLessThan(70);
	});

	it('uses user space gradients and gradientTransform', () => {
		const pixel = render(
			imported(
				svg(
					'<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="50" y="10" width="40" height="40" fill="url(#g)"/>'
				)
			)
		);
		expectColor(pixel(52, 30), [122, 0, 133], 'user space: x = 50 is the middle of the gradient');
		expectColor(pixel(88, 30), [31, 0, 224], 'and x = 88 is 88% of the way');
	});

	it('applies opacity from the element and from fill-opacity', () => {
		const pixel = render(
			imported(
				svg(
					'<rect width="40" height="40" fill="red" opacity="0.5"/><rect x="50" width="40" height="40" fill="red" fill-opacity="0.5"/>'
				)
			)
		);
		expectColor(pixel(20, 20), [250, 122, 122], 'element opacity');
		expectColor(pixel(70, 20), [250, 122, 122], 'fill opacity');
	});
});
