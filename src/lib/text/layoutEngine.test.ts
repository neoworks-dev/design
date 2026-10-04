import { beforeAll, describe, expect, it } from 'vitest';
import type { TextNode } from '../document/types';
import { RenderSurface } from '../renderer/surface';
import { createTextTestKit, paragraphOf, textNode, type TextTestKit } from './testing';

let kit: TextTestKit;

beforeAll(async () => {
	kit = await createTextTestKit();
});

const SENTENCE = 'Hello world again and again';

function inkBounds(node: TextNode): { right: number; bottom: number } {
	const surface = RenderSurface.offscreen(kit.kit, kit.tracker, 400, 300);
	surface.frame((canvas) => {
		canvas.clear(kit.kit.WHITE);
		kit.engine.draw(canvas, node);
	});
	const pixels = surface.readPixels({ x: 0, y: 0, width: 400, height: 300 });
	let right = 0;
	let bottom = 0;
	for (let y = 0; y < 300; y += 1) {
		for (let x = 0; x < 400; x += 1) {
			if (pixels[(y * 400 + x) * 4] > 200) continue;
			right = Math.max(right, x + 1);
			bottom = Math.max(bottom, y + 1);
		}
	}
	surface.dispose();
	return { right, bottom };
}

describe('resize modes', () => {
	it('auto width lays out on one line and measures the widest line', () => {
		const node = textNode([paragraphOf(SENTENCE)], { textAutoResize: 'WIDTH_AND_HEIGHT' });
		const measure = kit.engine.measure(node);
		expect(measure.lineCount).toBe(1);
		expect(measure.width).toBeGreaterThan(100);
		expect(measure.height).toBeGreaterThan(14);
	});

	it('auto width follows the longest paragraph and stacks paragraphs', () => {
		const node = textNode([paragraphOf('short'), paragraphOf(SENTENCE)], {
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		const single = kit.engine.measure(
			textNode([paragraphOf(SENTENCE)], { textAutoResize: 'WIDTH_AND_HEIGHT' })
		);
		const measure = kit.engine.measure(node);
		expect(measure.width).toBe(single.width);
		expect(measure.height).toBeCloseTo(single.height * 2, 0);
	});

	it('auto height wraps at the node width', () => {
		const node = textNode([paragraphOf(SENTENCE)], { textAutoResize: 'HEIGHT', width: 80 });
		const measure = kit.engine.measure(node);
		expect(measure.width).toBe(80);
		expect(measure.lineCount).toBeGreaterThan(2);
	});

	it('fixed size keeps the node width and wraps, the box height is the node height', () => {
		const node = textNode([paragraphOf(SENTENCE)], {
			textAutoResize: 'NONE',
			width: 120,
			height: 200
		});
		expect(kit.engine.measure(node).width).toBe(120);
		expect(kit.engine.blockOffsetY(node)).toBe(0);
	});

	it('vertical alignment moves the block inside a fixed box', () => {
		const props = { textAutoResize: 'NONE', width: 200, height: 100 } as const;
		const top = textNode([paragraphOf('x')], { ...props, textAlignVertical: 'TOP' });
		const center = textNode([paragraphOf('x')], { ...props, textAlignVertical: 'CENTER' });
		const bottom = textNode([paragraphOf('x')], { ...props, textAlignVertical: 'BOTTOM' });
		const block = kit.engine.measure(top).height;
		expect(kit.engine.blockOffsetY(top)).toBe(0);
		expect(kit.engine.blockOffsetY(center)).toBeCloseTo((100 - block) / 2, 5);
		expect(kit.engine.blockOffsetY(bottom)).toBeCloseTo(100 - block, 5);
	});
});

describe('measured size equals drawn size', () => {
	it('the ink of auto-width text stays inside the measured box and fills it', () => {
		const node = textNode([paragraphOf('Hamburgefonstiv')], {
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		const measure = kit.engine.measure(node);
		const ink = inkBounds(node);
		expect(ink.right).toBeLessThanOrEqual(Math.ceil(measure.width));
		expect(ink.right).toBeGreaterThan(measure.width - 4);
		expect(ink.bottom).toBeLessThanOrEqual(Math.ceil(measure.height));
	});

	it('wrapped text stays inside the measured block', () => {
		const node = textNode([paragraphOf(SENTENCE)], { textAutoResize: 'HEIGHT', width: 100 });
		const measure = kit.engine.measure(node);
		const ink = inkBounds(node);
		expect(ink.right).toBeLessThanOrEqual(100);
		expect(ink.bottom).toBeLessThanOrEqual(Math.ceil(measure.height));
		expect(ink.bottom).toBeGreaterThan(measure.height - 6);
	});

	it('line height in pixels sets the line height exactly', () => {
		const node = textNode(
			[paragraphOf('one'), paragraphOf('two')],
			{ textAutoResize: 'WIDTH_AND_HEIGHT' },
			{ fontSize: 20, lineHeight: { value: 40, unit: 'PIXELS' } }
		);
		expect(kit.engine.measure(node).height).toBe(80);
	});

	it('paragraph spacing separates paragraphs but not after the last one', () => {
		const spaced = textNode(
			[paragraphOf('one', {}, { spacingAfter: 10 }), paragraphOf('two', {}, { spacingAfter: 10 })],
			{ textAutoResize: 'WIDTH_AND_HEIGHT' }
		);
		const tight = textNode([paragraphOf('one'), paragraphOf('two')], {
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		expect(kit.engine.measure(spaced).height - kit.engine.measure(tight).height).toBe(10);
	});
});

describe('cache', () => {
	it('serves an unchanged node from the cache and relayouts only the edited one', () => {
		const first = textNode([paragraphOf('first')], { id: 'cache-a' });
		const second = textNode([paragraphOf('second')], { id: 'cache-b' });
		kit.engine.layout(first);
		kit.engine.layout(second);
		const built = kit.engine.buildCount;

		for (let round = 0; round < 50; round += 1) {
			kit.engine.layout(first);
			kit.engine.layout(second);
		}
		expect(kit.engine.buildCount).toBe(built);

		const edited = { ...second, paragraphs: [paragraphOf('second, edited')] };
		kit.engine.layout(first);
		kit.engine.layout(edited);
		expect(kit.engine.buildCount).toBe(built + 1);
	});

	it('benchmark: 300 nodes drawn 20 frames in a row are laid out once; one edit relayouts one', () => {
		const nodes = Array.from({ length: 300 }, (_, index) =>
			textNode([paragraphOf(`Node number ${index} with some text`)], { id: `bench-${index}` })
		);
		const built = kit.engine.buildCount;
		const started = performance.now();
		for (let frame = 0; frame < 20; frame += 1) {
			for (const node of nodes) kit.engine.layout(node);
		}
		const milliseconds = performance.now() - started;
		const builds = kit.engine.buildCount - built;
		const requests = 20 * 300;
		console.log(
			`text layout cache: ${requests} requests, ${builds} layouts, hit rate ${(((requests - builds) / requests) * 100).toFixed(1)}%, ${milliseconds.toFixed(0)} ms`
		);
		expect(builds).toBe(300);
		nodes[7] = { ...nodes[7], paragraphs: [paragraphOf('edited')] };
		for (const node of nodes) kit.engine.layout(node);
		expect(kit.engine.buildCount - built).toBe(301);
	});

	it('a structurally equal copy (variables resolved to the same values) is a cache hit', () => {
		const node = textNode([paragraphOf('same')], { id: 'cache-c' });
		kit.engine.layout(node);
		const built = kit.engine.buildCount;
		kit.engine.layout({ ...node, paragraphs: structuredClone(node.paragraphs) });
		expect(kit.engine.buildCount).toBe(built);
	});

	it('moving a node does not relayout it, resizing a fixed box does', () => {
		const node = textNode([paragraphOf(SENTENCE)], { id: 'cache-d', textAutoResize: 'HEIGHT' });
		kit.engine.layout(node);
		const built = kit.engine.buildCount;
		kit.engine.layout({
			...node,
			transform: [
				[1, 0, 50],
				[0, 1, 50]
			]
		});
		expect(kit.engine.buildCount).toBe(built);
		kit.engine.layout({ ...node, width: 90 });
		expect(kit.engine.buildCount).toBe(built + 1);
	});

	it('a font arriving invalidates every layout', async () => {
		const own = await createTextTestKit();
		const node = textNode([paragraphOf('late')], { id: 'cache-e' });
		own.engine.layout(node);
		const built = own.engine.buildCount;
		own.engine.invalidateAll();
		own.engine.layout(node);
		expect(own.engine.buildCount).toBe(built + 1);
		own.engine.dispose();
	});

	it('forgetting a node deletes its Skia paragraphs', async () => {
		const own = await createTextTestKit();
		const before = own.tracker.liveCount;
		const node = textNode([paragraphOf('gone')], { id: 'cache-f' });
		own.engine.layout(node);
		expect(own.tracker.liveCount).toBeGreaterThan(before);
		own.engine.forget('cache-f');
		expect(own.tracker.liveCount).toBe(before);
		own.engine.dispose();
		expect(own.tracker.liveCount).toBe(0);
	});
});

describe('faces', () => {
	it('selects the face by name: bold is wider than regular', () => {
		const regular = textNode([paragraphOf('Hamburgefonstiv')], {
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		const bold = textNode(
			[paragraphOf('Hamburgefonstiv', { fontName: { family: 'Geist', style: 'Bold' } })],
			{
				textAutoResize: 'WIDTH_AND_HEIGHT'
			}
		);
		expect(kit.engine.measure(bold).width).toBeGreaterThan(kit.engine.measure(regular).width + 4);
	});
});

describe('missing fonts', () => {
	it('flags the font, keeps the reference and lays out deterministically with the substitute', () => {
		const missing = textNode(
			[paragraphOf('Papyrus text')],
			{},
			{
				fontName: { family: 'Papyrus', style: 'Regular' }
			}
		);
		const installed = textNode([paragraphOf('Papyrus text')]);
		const layout = kit.engine.layout(missing);
		expect(layout.missingFonts).toEqual([{ family: 'Papyrus', style: 'Regular' }]);
		expect(missing.defaultStyle.fontName.family).toBe('Papyrus');
		expect(kit.engine.layout(installed).missingFonts).toEqual([]);
		expect(kit.engine.measure(missing)).toEqual(kit.engine.measure(installed));
	});

	it('asks for faces that are not registered yet and still produces a layout', async () => {
		const bare = await createTextTestKit(false);
		const layout = bare.engine.layout(textNode([paragraphOf('wait')]));
		expect(layout.pendingFaces.map((face) => face.family)).toEqual(['Geist']);
		bare.engine.dispose();
	});
});

describe('lists, truncation and styles', () => {
	it('indents list paragraphs and numbers ordered items', () => {
		const node = textNode(
			[
				paragraphOf('a', {}, { list: 'ORDERED' }),
				paragraphOf('b', {}, { list: 'ORDERED' }),
				paragraphOf('c', {}, { list: 'UNORDERED', listLevel: 1 })
			],
			{ textAutoResize: 'HEIGHT' }
		);
		const layout = kit.engine.layout(node);
		expect(layout.paragraphs[0].left).toBe(24);
		expect(layout.paragraphs[2].left).toBe(48);
		expect(layout.paragraphs.every((item) => item.marker !== null)).toBe(true);
	});

	it('ending truncation caps the lines across paragraphs', () => {
		const node = textNode(
			[paragraphOf(`${SENTENCE} ${SENTENCE}`), paragraphOf('second paragraph')],
			{ textAutoResize: 'NONE', width: 90, height: 60, textTruncation: 'ENDING', maxLines: 2 }
		);
		const layout = kit.engine.layout(node);
		expect(layout.lineCount).toBe(2);
		expect(layout.paragraphs[1].visible).toBe(false);
	});

	it('letter spacing in percent widens the text', () => {
		const plain = kit.engine.measure(
			textNode([paragraphOf('spacing')], { textAutoResize: 'WIDTH_AND_HEIGHT' })
		);
		const spaced = kit.engine.measure(
			textNode(
				[paragraphOf('spacing')],
				{ textAutoResize: 'WIDTH_AND_HEIGHT' },
				{
					letterSpacing: { value: 50, unit: 'PERCENT' }
				}
			)
		);
		expect(spaced.width).toBeGreaterThan(plain.width + 20);
	});

	it('upper case keeps offsets and widens the text', () => {
		const lower = textNode([paragraphOf('weight')], { textAutoResize: 'WIDTH_AND_HEIGHT' });
		const upper = textNode([paragraphOf('weight', { textCase: 'UPPER' })], {
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		expect(kit.engine.measure(upper).width).toBeGreaterThan(kit.engine.measure(lower).width);
	});
});

describe('geometry for editing', () => {
	const node = textNode([paragraphOf('Hello world'), paragraphOf('Second')], {
		textAutoResize: 'WIDTH_AND_HEIGHT'
	});

	it('caret x grows with the offset and the caret of paragraph 2 is below paragraph 1', () => {
		const start = kit.engine.caretRect(node, { paragraph: 0, offset: 0 });
		const middle = kit.engine.caretRect(node, { paragraph: 0, offset: 5 });
		const end = kit.engine.caretRect(node, { paragraph: 0, offset: 11 });
		const next = kit.engine.caretRect(node, { paragraph: 1, offset: 0 });
		expect(start.x).toBe(0);
		expect(middle.x).toBeGreaterThan(start.x);
		expect(end.x).toBeGreaterThan(middle.x);
		expect(next.y).toBeGreaterThanOrEqual(end.y + end.height - 1);
		expect(end.height).toBeGreaterThan(10);
	});

	it('an empty paragraph still has a caret with a line height', () => {
		const empty = textNode([paragraphOf('')], { textAutoResize: 'WIDTH_AND_HEIGHT' });
		const caret = kit.engine.caretRect(empty, { paragraph: 0, offset: 0 });
		expect(caret.height).toBeGreaterThan(10);
	});

	it('range rects cover the selected text and span paragraphs', () => {
		const rects = kit.engine.rangeRects(node, {
			start: { paragraph: 0, offset: 6 },
			end: { paragraph: 1, offset: 3 }
		});
		expect(rects.length).toBeGreaterThanOrEqual(3);
		const first = rects[0];
		expect(first.x).toBeCloseTo(kit.engine.caretRect(node, { paragraph: 0, offset: 6 }).x, 0);
	});

	it('offsetAtPoint inverts caretRect', () => {
		for (const offset of [0, 3, 7, 11]) {
			const caret = kit.engine.caretRect(node, { paragraph: 0, offset });
			const hit = kit.engine.offsetAtPoint(node, { x: caret.x + 0.5, y: caret.y + 4 });
			expect(hit).toEqual({ paragraph: 0, offset });
		}
		expect(kit.engine.offsetAtPoint(node, { x: 5000, y: 900 })).toEqual({
			paragraph: 1,
			offset: 6
		});
	});

	it('lineBounds and wordBoundary describe the line and word around an offset', () => {
		const wrapped = textNode([paragraphOf(SENTENCE)], { textAutoResize: 'HEIGHT', width: 80 });
		const line = kit.engine.lineBounds(wrapped, { paragraph: 0, offset: 8 });
		expect(line.lineNumber).toBe(1);
		expect(line.start).toBeLessThanOrEqual(8);
		expect(line.end).toBeGreaterThan(8);
		expect(kit.engine.wordBoundary(node, { paragraph: 0, offset: 8 })).toEqual({
			start: 6,
			end: 11
		});
	});
});
