// Text outlines against the real Paragraph drawing: the glyph paths built from the font file and
// the shaped glyph positions must cover the same pixels as drawing the text (golden diff).

import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { pathFromCommands } from '../renderer/draw/skiaPath';
import { parseGlyphOutlineFont, type GlyphOutlineFont } from './glyphOutlines';
import {
	loadTestFaces,
	createTextTestKit,
	paragraphOf,
	textNode,
	type TextTestKit
} from './testing';
import { textOutlineCommands } from './textOutline';

const WIDTH = 240;
const HEIGHT = 80;

let testKit: TextTestKit;
let fonts: Map<string, GlyphOutlineFont>;

beforeAll(async () => {
	testKit = await createTextTestKit();
	fonts = new Map();
	for (const { face, bytes } of await loadTestFaces()) {
		const font = parseGlyphOutlineFont(bytes);
		if (font) fonts.set(`${face.family} ${face.style}`, font);
	}
});

function renderWith(kit: CanvasKit, draw: (surface: Surface) => void): Uint8Array {
	const surface = kit.MakeSurface(WIDTH, HEIGHT);
	if (!surface) throw new Error('no surface');
	surface.getCanvas().clear(kit.WHITE);
	draw(surface);
	const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
		width: WIDTH,
		height: HEIGHT,
		colorType: kit.ColorType.RGBA_8888,
		alphaType: kit.AlphaType.Unpremul,
		colorSpace: kit.ColorSpace.SRGB
	});
	surface.delete();
	if (!pixels) throw new Error('no pixels');
	return new Uint8Array(pixels as Uint8Array);
}

/** Share of pixels that differ clearly, between drawing the paragraph and filling the outline. */
function differingShare(node: ReturnType<typeof textNode>): {
	share: number;
	inked: number;
	glyphs: number;
} {
	const { kit, engine } = testKit;
	const layout = engine.layout(node);
	const commands = textOutlineCommands(node, layout, engine.blockOffsetY(node), (style) =>
		fonts.get(`${style.fontName.family} ${style.fontName.style}`)
	);
	const drawn = renderWith(kit, (surface) => {
		const paint = new kit.Paint();
		paint.setColor(kit.BLACK);
		engine.draw(surface.getCanvas(), node);
		paint.delete();
		surface.flush();
	});
	const outlined = renderWith(kit, (surface) => {
		const path = pathFromCommands(kit, commands, 'NONZERO');
		const paint = new kit.Paint();
		paint.setAntiAlias(true);
		paint.setColor(kit.BLACK);
		surface.getCanvas().drawPath(path, paint);
		paint.delete();
		path.delete();
		surface.flush();
	});
	// Glyph edges are hinted and gamma adjusted by Skia's text rasteriser but not by a path fill,
	// so compare the ink per 4x4 block instead of single pixels: a misplaced glyph moves ink
	// between blocks, a rasteriser difference does not.
	let ink = 0;
	let displaced = 0;
	for (let top = 0; top < HEIGHT; top += BLOCK) {
		for (let left = 0; left < WIDTH; left += BLOCK) {
			const drawnInk = blockInk(drawn, left, top);
			ink += drawnInk;
			displaced += Math.abs(drawnInk - blockInk(outlined, left, top));
		}
	}
	return { share: displaced / Math.max(1, ink), inked: ink, glyphs: commands.length };
}

const BLOCK = 4;

function blockInk(pixels: Uint8Array, left: number, top: number): number {
	let total = 0;
	for (let row = top; row < top + BLOCK; row += 1) {
		for (let column = left; column < left + BLOCK; column += 1) {
			total += 255 - pixels[(row * WIDTH + column) * 4];
		}
	}
	return total / (255 * BLOCK * BLOCK);
}

describe('parseGlyphOutlineFont', () => {
	it('parses the bundled Geist faces and reads their metrics', () => {
		expect(fonts.size).toBeGreaterThan(0);
		for (const font of fonts.values()) {
			expect(font.unitsPerEm).toBeGreaterThan(0);
			expect(font.glyphCount).toBeGreaterThan(100);
		}
	});

	it('returns null for a file without TrueType outlines', () => {
		expect(parseGlyphOutlineFont(new ArrayBuffer(64))).toBeNull();
	});

	it('closes every contour of a glyph and keeps it inside the em box', () => {
		const font = fonts.get('Geist Regular');
		if (!font) throw new Error('no face');
		const commands = font.glyphCommands(40, 100, 0, 0);
		expect(commands.filter((command) => command.op === 'close').length).toBeGreaterThan(0);
		for (const command of commands) {
			if (command.op === 'cubic') expect(Math.abs(command.y)).toBeLessThan(200);
		}
	});
});

describe('textOutlineCommands', () => {
	it('covers the pixels Paragraph draws for a line of text', () => {
		const node = textNode(
			[paragraphOf('Hamburgefonts 123')],
			{ width: 220, height: 40 },
			{ fontSize: 24 }
		);
		const { share, inked, glyphs } = differingShare(node);
		expect(glyphs).toBeGreaterThan(50);
		expect(inked).toBeGreaterThan(20);
		expect(share).toBeLessThan(0.3);
	});

	it('follows wrapped lines and several paragraphs with styled runs', () => {
		const node = textNode(
			[
				paragraphOf('Wrapped text that needs more than one line to fit'),
				{
					...paragraphOf('', {}),
					runs: [
						{ text: 'Bold ', style: { fontName: { family: 'Geist', style: 'Bold' } } },
						{ text: 'then regular', style: {} }
					]
				}
			],
			{ width: 150, height: 70 },
			{ fontSize: 14 }
		);
		const { share, inked } = differingShare(node);
		expect(inked).toBeGreaterThan(20);
		expect(share).toBeLessThan(0.3);
	});
});
