import { describe, expect, it } from 'vitest';
import { defaultTextStyle } from '../document/defaults';
import { MIXED, plainText, type TextRange } from '../document/text';
import type { Paragraph, TextStyle } from '../document/types';
import {
	boldPatch,
	changeListLevel,
	decorationPatch,
	fontSizePatch,
	hyperlinkPatch,
	isBold,
	italicPatch,
	letterSpacingPatch,
	lineHeightPatch,
	mergeRangeStyles,
	restyleNode,
	restyleRange,
	setAlignment,
	styleOfRange,
	toggleList,
	weightPatch
} from './formatting';
import { paragraphOf } from './testing';

const DEFAULT: TextStyle = {
	...defaultTextStyle(),
	fontName: { family: 'Geist', style: 'Regular' },
	fontSize: 16
};

function range(start: [number, number], end: [number, number]): TextRange {
	return {
		start: { paragraph: start[0], offset: start[1] },
		end: { paragraph: end[0], offset: end[1] }
	};
}

function runsOf(paragraphs: Paragraph[], index = 0): [string, Partial<TextStyle>][] {
	return paragraphs[index].runs.map((run) => [run.text, run.style]);
}

const BOLD = { fontWeight: 700, fontName: { family: 'Geist', style: 'Bold' } };

describe('run splitting', () => {
	it('bold on the middle of a run splits it in three, bold off merges it back into one', () => {
		const paragraphs = [paragraphOf('hello world')];
		const bold = restyleRange(paragraphs, DEFAULT, range([0, 3], [0, 8]), boldPatch(true));
		expect(runsOf(bold)).toEqual([
			['hel', {}],
			['lo wo', BOLD],
			['rld', {}]
		]);
		const regular = restyleRange(bold, DEFAULT, range([0, 3], [0, 8]), boldPatch(false));
		expect(runsOf(regular)).toEqual([['hello world', {}]]);
	});

	it('a range across paragraphs only touches the covered characters', () => {
		const paragraphs = [paragraphOf('abc'), paragraphOf('def')];
		const result = restyleRange(paragraphs, DEFAULT, range([0, 2], [1, 1]), boldPatch(true));
		expect(runsOf(result, 0)).toEqual([
			['ab', {}],
			['c', BOLD]
		]);
		expect(runsOf(result, 1)).toEqual([
			['d', BOLD],
			['ef', {}]
		]);
	});

	it('two adjacent ranges with the same style become one run', () => {
		const paragraphs = [paragraphOf('abcdef')];
		const first = restyleRange(paragraphs, DEFAULT, range([0, 0], [0, 3]), boldPatch(true));
		const both = restyleRange(first, DEFAULT, range([0, 3], [0, 6]), boldPatch(true));
		expect(runsOf(both)).toEqual([['abcdef', BOLD]]);
	});

	it('does not mutate its input', () => {
		const paragraphs = [paragraphOf('hello')];
		const snapshot = structuredClone(paragraphs);
		restyleRange(paragraphs, DEFAULT, range([0, 1], [0, 3]), boldPatch(true));
		expect(paragraphs).toEqual(snapshot);
	});
});

describe('toggles', () => {
	it('bold keeps italic and the family, italic keeps the weight', () => {
		const bold = restyleRange([paragraphOf('x')], DEFAULT, range([0, 0], [0, 1]), boldPatch(true));
		const both = restyleRange(bold, DEFAULT, range([0, 0], [0, 1]), italicPatch(true));
		expect(runsOf(both)[0][1]).toEqual({
			fontWeight: 700,
			fontName: { family: 'Geist', style: 'Bold Italic' }
		});
		const unbold = restyleRange(both, DEFAULT, range([0, 0], [0, 1]), boldPatch(false));
		expect(runsOf(unbold)[0][1].fontName).toEqual({ family: 'Geist', style: 'Italic' });
		const plain = restyleRange(unbold, DEFAULT, range([0, 0], [0, 1]), italicPatch(false));
		expect(runsOf(plain)).toEqual([['x', {}]]);
	});

	it('underline and strikethrough replace each other and clear with NONE', () => {
		const underlined = restyleRange(
			[paragraphOf('x')],
			DEFAULT,
			range([0, 0], [0, 1]),
			decorationPatch('UNDERLINE')
		);
		expect(runsOf(underlined)[0][1]).toEqual({ textDecoration: 'UNDERLINE' });
		const struck = restyleRange(
			underlined,
			DEFAULT,
			range([0, 0], [0, 1]),
			decorationPatch('STRIKETHROUGH')
		);
		expect(runsOf(struck)[0][1]).toEqual({ textDecoration: 'STRIKETHROUGH' });
		expect(
			runsOf(restyleRange(struck, DEFAULT, range([0, 0], [0, 1]), decorationPatch('NONE')))
		).toEqual([['x', {}]]);
	});

	it('isBold reads a range: all bold is bold, mixed or regular is not', () => {
		const paragraphs = [paragraphOf('abcd')];
		const half = restyleRange(paragraphs, DEFAULT, range([0, 0], [0, 2]), boldPatch(true));
		expect(isBold(styleOfRange(half, DEFAULT, range([0, 0], [0, 2])))).toBe(true);
		expect(isBold(styleOfRange(half, DEFAULT, range([0, 0], [0, 4])))).toBe(false);
		expect(isBold(styleOfRange(half, DEFAULT, range([0, 2], [0, 4])))).toBe(false);
	});
});

describe('stepping', () => {
	it('font size steps per run, so runs of different sizes keep their difference', () => {
		const paragraphs: Paragraph[] = [
			{
				...paragraphOf(''),
				runs: [
					{ text: 'small', style: { fontSize: 12 } },
					{ text: 'normal', style: {} }
				]
			}
		];
		const result = restyleRange(paragraphs, DEFAULT, range([0, 0], [0, 11]), fontSizePatch(1));
		expect(runsOf(result)).toEqual([
			['small', { fontSize: 13 }],
			['normal', { fontSize: 17 }]
		]);
		const back = restyleRange(result, DEFAULT, range([0, 0], [0, 11]), fontSizePatch(-1));
		expect(runsOf(back)).toEqual([
			['small', { fontSize: 12 }],
			['normal', {}]
		]);
	});

	it('font size never goes below 1', () => {
		const tiny = restyleNode([paragraphOf('x')], { ...DEFAULT, fontSize: 1 }, fontSizePatch(-1));
		expect(tiny.defaultStyle.fontSize).toBe(1);
	});

	it('line height: automatic becomes 1.2 times the size, then steps in pixels or percent', () => {
		const first = restyleNode([paragraphOf('x')], DEFAULT, lineHeightPatch(1));
		expect(first.defaultStyle.lineHeight).toEqual({ value: 20, unit: 'PIXELS' });
		const second = restyleNode(first.paragraphs, first.defaultStyle, lineHeightPatch(-1));
		expect(second.defaultStyle.lineHeight).toEqual({ value: 19, unit: 'PIXELS' });
		const percent = restyleNode(
			[paragraphOf('x')],
			{ ...DEFAULT, lineHeight: { value: 120, unit: 'PERCENT' } },
			lineHeightPatch(1)
		);
		expect(percent.defaultStyle.lineHeight).toEqual({ value: 125, unit: 'PERCENT' });
	});

	it('letter spacing steps and keeps its unit', () => {
		const result = restyleNode([paragraphOf('x')], DEFAULT, letterSpacingPatch(1));
		expect(result.defaultStyle.letterSpacing).toEqual({ value: 1, unit: 'PERCENT' });
	});

	it('weight steps through the named weights and clamps', () => {
		const heavier = restyleRange(
			[paragraphOf('x')],
			DEFAULT,
			range([0, 0], [0, 1]),
			weightPatch(100)
		);
		expect(runsOf(heavier)[0][1]).toEqual({
			fontWeight: 500,
			fontName: { family: 'Geist', style: 'Medium' }
		});
		const lightest = restyleNode(
			[paragraphOf('x')],
			{ ...DEFAULT, fontName: { family: 'Geist', style: 'Thin' } },
			weightPatch(-100)
		);
		expect(lightest.defaultStyle.fontName.style).toBe('Thin');
	});
});

describe('whole node', () => {
	it('changes the default style and rewrites the runs that overrode the property', () => {
		const paragraphs: Paragraph[] = [
			{
				...paragraphOf(''),
				runs: [
					{ text: 'a', style: {} },
					{ text: 'b', style: { fontSize: 24 } }
				]
			},
			paragraphOf('')
		];
		const result = restyleNode(paragraphs, DEFAULT, fontSizePatch(2));
		expect(result.defaultStyle.fontSize).toBe(18);
		expect(runsOf(result.paragraphs)).toEqual([
			['a', {}],
			['b', { fontSize: 26 }]
		]);
		expect(result.paragraphs[1].runs).toEqual([]);
	});

	it('bold on the whole node leaves the runs merged and the default bold', () => {
		const result = restyleNode([paragraphOf('one two')], DEFAULT, boldPatch(true));
		expect(result.defaultStyle.fontWeight).toBe(700);
		expect(runsOf(result.paragraphs)).toEqual([['one two', {}]]);
	});
});

describe('mixed ranges', () => {
	it('a range over differing sizes reports MIXED for the size and the common value for the rest', () => {
		const paragraphs = restyleRange(
			[paragraphOf('abcd')],
			DEFAULT,
			range([0, 0], [0, 2]),
			fontSizePatch(8)
		);
		const style = styleOfRange(paragraphs, DEFAULT, range([0, 0], [0, 4]));
		expect(style.fontSize).toBe(MIXED);
		expect(style.fontName).toEqual({ family: 'Geist', style: 'Regular' });
		expect(styleOfRange(paragraphs, DEFAULT, range([0, 0], [0, 2])).fontSize).toBe(24);
	});

	it('merging the styles of several nodes marks differing properties MIXED', () => {
		const merged = mergeRangeStyles([
			{ fontSize: 16, textDecoration: 'NONE' },
			{ fontSize: 20, textDecoration: 'NONE' }
		]);
		expect(merged).toEqual({ fontSize: MIXED, textDecoration: 'NONE' });
	});
});

describe('paragraph properties', () => {
	const paragraphs = [paragraphOf('a'), paragraphOf('b'), paragraphOf('c')];

	it('alignment applies to the paragraphs the range touches', () => {
		const result = setAlignment(paragraphs, range([0, 1], [1, 0]), 'CENTER');
		expect(result.map((paragraph) => paragraph.align)).toEqual(['CENTER', 'CENTER', 'LEFT']);
		expect(setAlignment(paragraphs, null, 'RIGHT').map((paragraph) => paragraph.align)).toEqual([
			'RIGHT',
			'RIGHT',
			'RIGHT'
		]);
	});

	it('list toggles on, switches kind, and off when every paragraph already has it', () => {
		const numbered = toggleList(paragraphs, range([0, 0], [1, 0]), 'ORDERED');
		expect(numbered.map((paragraph) => paragraph.list)).toEqual(['ORDERED', 'ORDERED', 'NONE']);
		const bulleted = toggleList(numbered, range([0, 0], [1, 0]), 'UNORDERED');
		expect(bulleted.map((paragraph) => paragraph.list)).toEqual(['UNORDERED', 'UNORDERED', 'NONE']);
		const off = toggleList(bulleted, range([0, 0], [1, 0]), 'UNORDERED');
		expect(off.map((paragraph) => paragraph.list)).toEqual(['NONE', 'NONE', 'NONE']);
	});

	it('Tab and Shift+Tab change the level of list items only; outdent at level 0 leaves the list', () => {
		const list = toggleList(paragraphs, range([0, 0], [1, 0]), 'UNORDERED');
		const indented = changeListLevel(list, range([0, 0], [2, 0]), 1);
		expect(indented.map((paragraph) => paragraph.listLevel)).toEqual([1, 1, 0]);
		const outdented = changeListLevel(indented, range([0, 0], [0, 0]), -1);
		expect(outdented[0].listLevel).toBe(0);
		const out = changeListLevel(outdented, range([0, 0], [0, 0]), -1);
		expect(out[0]).toMatchObject({ list: 'NONE', listLevel: 0 });
	});
});

describe('links', () => {
	it('a link goes on the range only, and removing it merges the runs back', () => {
		const linked = restyleRange(
			[paragraphOf('see docs here')],
			DEFAULT,
			range([0, 4], [0, 8]),
			hyperlinkPatch({ type: 'URL', value: 'https://example.com' })
		);
		expect(runsOf(linked)).toEqual([
			['see ', {}],
			['docs', { hyperlink: { type: 'URL', value: 'https://example.com' } }],
			[' here', {}]
		]);
		const removed = restyleRange(linked, DEFAULT, range([0, 4], [0, 8]), hyperlinkPatch(null));
		expect(runsOf(removed)).toEqual([['see docs here', {}]]);
		expect(plainText(removed)).toBe('see docs here');
	});
});
