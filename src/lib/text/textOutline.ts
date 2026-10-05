// The outline of laid out text as path commands (#103: flattening text). Skia's Paragraph has
// done the shaping (glyph ids, kerning, line breaks), so its shaped lines give the glyphs and
// where they sit; the glyph shapes come from the font files (glyphOutlines.ts). The commands are
// in the text node's local space, the same place `TextLayoutEngine.draw` puts the text.
//
// Not covered: underline and strikethrough, list markers, synthetic bold and italic.

import type { PathCommand } from '../document/outline';
import { resolveStyle } from '../document/text';
import type { Paragraph, TextNode, TextStyle } from '../document/types';
import type { GlyphOutlineFont } from './glyphOutlines';
import type { NodeTextLayout } from './layoutEngine';

interface StyleSpan {
	start: number;
	end: number;
	style: TextStyle;
}

export type GlyphFontLookup = (style: TextStyle) => GlyphOutlineFont | undefined;

function styleSpans(paragraph: Paragraph, node: TextNode): StyleSpan[] {
	const spans: StyleSpan[] = [];
	let start = 0;
	for (const run of paragraph.runs) {
		const end = start + run.text.length;
		spans.push({ start, end, style: resolveStyle(node.defaultStyle, run.style) });
		start = end;
	}
	return spans;
}

function spanAt(spans: readonly StyleSpan[], offset: number): StyleSpan | undefined {
	const found = spans.find((span) => offset >= span.start && offset < span.end);
	if (found) return found;
	return spans.at(-1);
}

/** The styles of the text, for loading the fonts they need before the outline is built. */
export function textStyles(node: TextNode): TextStyle[] {
	return node.paragraphs.flatMap((paragraph) => styleSpans(paragraph, node).map((s) => s.style));
}

export function textOutlineCommands(
	node: TextNode,
	layout: NodeTextLayout,
	blockOffsetY: number,
	fontFor: GlyphFontLookup
): PathCommand[] {
	const commands: PathCommand[] = [];
	for (const item of layout.paragraphs) {
		if (!item.skia) continue;
		const spans = styleSpans(node.paragraphs[item.index], node);
		const originX = item.left;
		const originY = blockOffsetY + item.top;
		for (const line of item.skia.getShapedLines()) {
			for (const run of line.runs) {
				for (let index = 0; index < run.glyphs.length; index += 1) {
					const span = spanAt(spans, run.offsets[index]);
					if (!span) continue;
					const font = fontFor(span.style);
					if (!font) continue;
					commands.push(
						...font.glyphCommands(
							run.glyphs[index],
							run.size,
							originX + run.positions[index * 2],
							originY + run.positions[index * 2 + 1]
						)
					);
				}
			}
		}
	}
	return commands;
}
