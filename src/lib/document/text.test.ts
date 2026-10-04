import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createNode, defaultTextStyle } from './defaults';
import { parseNode } from './schema';
import { DocumentStore, invertChange } from './store';
import { buildDocument, page, text as textSpec } from './fixtures';
import {
	MIXED,
	applyStyle,
	buildPlan,
	clearStyle,
	deleteRange,
	deepEqual,
	emptyParagraph,
	flatOffsetToPosition,
	flatRange,
	insertText,
	joinParagraphs,
	locateRun,
	normalizeParagraphs,
	paragraphsChange,
	plainText,
	positionToFlatOffset,
	readStyle,
	resolveStyle,
	splitParagraph,
	type RunLocation,
	type TextPosition,
	type TextRange
} from './text';
import type { Paragraph, TextStyle } from './types';

const defaultStyle = defaultTextStyle();

function paragraphOf(...runs: [string, Partial<TextStyle>?][]): Paragraph {
	return {
		...emptyParagraph(),
		runs: runs.map(([text, style]) => ({ text, style: { ...style } }))
	};
}

function at(paragraph: number, offset: number): TextPosition {
	return { paragraph, offset };
}
function span(from: TextPosition, to: TextPosition): TextRange {
	return { start: from, end: to };
}

const bold: Partial<TextStyle> = { fontWeight: 700 };
const italicFont: Partial<TextStyle> = { fontName: { family: 'Inter', style: 'Italic' } };

// ---------- model used by the property tests ----------

/** One resolved style per character, with paragraph breaks as `null`. */
function characterStyles(paragraphs: Paragraph[]): (TextStyle | null)[] {
	const result: (TextStyle | null)[] = [];
	paragraphs.forEach((paragraph, index) => {
		if (index > 0) result.push(null);
		for (const run of paragraph.runs) {
			for (let count = 0; count < run.text.length; count += 1) {
				result.push(resolveStyle(defaultStyle, run.style));
			}
		}
	});
	return result;
}

function isNormalized(paragraphs: Paragraph[]): boolean {
	if (paragraphs.length === 0) return false;
	return paragraphs.every((paragraph) => {
		if (paragraph.runs.some((run) => run.text === '')) return false;
		return paragraph.runs.every((run, position) => {
			if (position === 0) return true;
			return !deepEqual(paragraph.runs[position - 1].style, run.style);
		});
	});
}

const styleArbitrary = fc.oneof(
	fc.constant<Partial<TextStyle>>({}),
	fc.constant<Partial<TextStyle>>(bold),
	fc.constant<Partial<TextStyle>>(italicFont),
	fc.constant<Partial<TextStyle>>({ fontSize: 24 }),
	fc.constant<Partial<TextStyle>>({ fontWeight: 700, fontSize: 24 }),
	fc.constant<Partial<TextStyle>>({ textStyleId: 'style-1' }),
	fc.constant<Partial<TextStyle>>({
		boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'v1' } }
	})
);

const textArbitrary = fc.string({
	unit: fc.constantFrom('a', 'b', 'c', ' ', 'é', '漢'),
	maxLength: 6
});

// Raw (possibly un-normalized) paragraphs: empty runs and mergeable neighbours are allowed.
const rawParagraphArbitrary: fc.Arbitrary<Paragraph> = fc
	.array(fc.record({ text: textArbitrary, style: styleArbitrary }), { maxLength: 5 })
	.map((runs) => ({ ...emptyParagraph(), runs }));
const rawParagraphsArbitrary = fc.array(rawParagraphArbitrary, { minLength: 0, maxLength: 4 });

const normalizedArbitrary = rawParagraphsArbitrary.map(normalizeParagraphs);

function rangeArbitrary(paragraphs: Paragraph[]): fc.Arbitrary<TextRange> {
	const total = plainText(paragraphs).length;
	return fc
		.tuple(fc.integer({ min: 0, max: total }), fc.integer({ min: 0, max: total }))
		.map(([first, second]) =>
			flatRange(paragraphs, Math.min(first, second), Math.max(first, second))
		);
}

const withRange = normalizedArbitrary.chain((paragraphs) =>
	rangeArbitrary(paragraphs).map((range) => ({ paragraphs, range }))
);

// ---------- normalization ----------

describe('normalizeParagraphs', () => {
	it('drops empty runs', () => {
		const result = normalizeParagraphs([paragraphOf(['', bold], ['a'], ['', {}])]);
		expect(result[0].runs).toEqual([{ text: 'a', style: {} }]);
	});

	it('merges adjacent runs with equal styles, regardless of key order', () => {
		const result = normalizeParagraphs([
			paragraphOf(
				['a', { fontWeight: 700, fontSize: 24 }],
				['b', { fontSize: 24, fontWeight: 700 }]
			)
		]);
		expect(result[0].runs).toEqual([{ text: 'ab', style: { fontWeight: 700, fontSize: 24 } }]);
	});

	it('treats an undefined property like a missing one', () => {
		const result = normalizeParagraphs([paragraphOf(['a', { hyperlink: undefined }], ['b'])]);
		expect(result[0].runs).toHaveLength(1);
	});

	it('keeps runs apart that differ in text style id or variable bindings', () => {
		const bound = { boundVariables: { fontSize: { type: 'VARIABLE_ALIAS' as const, id: 'v1' } } };
		expect(
			normalizeParagraphs([paragraphOf(['a'], ['b', { textStyleId: 's' }])])[0].runs
		).toHaveLength(2);
		expect(normalizeParagraphs([paragraphOf(['a'], ['b', bound])])[0].runs).toHaveLength(2);
		expect(
			normalizeParagraphs([paragraphOf(['a', bound], ['b', { textStyleId: 's', ...bound }])])[0]
				.runs
		).toHaveLength(2);
		expect(
			normalizeParagraphs([
				paragraphOf(['a', { textStyleId: 's' }], ['b', { textStyleId: 's' }])
			])[0].runs
		).toHaveLength(1);
	});

	it('does not merge across paragraphs', () => {
		const result = normalizeParagraphs([paragraphOf(['a']), paragraphOf(['b'])]);
		expect(result).toHaveLength(2);
	});

	it('keeps at least one paragraph', () => {
		const result = normalizeParagraphs([]);
		expect(result).toHaveLength(1);
		expect(result[0].runs).toEqual([]);
	});

	it('does not mutate its input', () => {
		const input = [paragraphOf(['a'], ['b'])];
		const snapshot = structuredClone(input);
		normalizeParagraphs(input);
		expect(input).toEqual(snapshot);
	});

	it('property: idempotent', () => {
		fc.assert(
			fc.property(rawParagraphsArbitrary, (paragraphs) => {
				const once = normalizeParagraphs(paragraphs);
				return deepEqual(normalizeParagraphs(once), once) && isNormalized(once);
			})
		);
	});

	it('property: never changes the visible text or the style of any character', () => {
		fc.assert(
			fc.property(rawParagraphsArbitrary, (paragraphs) => {
				const normalized = normalizeParagraphs(paragraphs);
				const sameText = plainText(normalized) === plainText(paragraphs);
				return sameText && deepEqual(characterStyles(normalized), characterStyles(paragraphs));
			})
		);
	});
});

// ---------- mapping ----------

describe('position mapping', () => {
	const paragraphs = normalizeParagraphs([
		paragraphOf(['ab', bold], ['cd']),
		paragraphOf(),
		paragraphOf(['xyz'])
	]);

	it('maps flat offsets to positions and back', () => {
		expect(flatOffsetToPosition(paragraphs, 0)).toEqual(at(0, 0));
		expect(flatOffsetToPosition(paragraphs, 4)).toEqual(at(0, 4));
		expect(flatOffsetToPosition(paragraphs, 5)).toEqual(at(1, 0));
		expect(flatOffsetToPosition(paragraphs, 6)).toEqual(at(2, 0));
		expect(flatOffsetToPosition(paragraphs, 9)).toEqual(at(2, 3));
		expect(positionToFlatOffset(paragraphs, at(2, 3))).toBe(9);
	});

	it('rejects out of range input', () => {
		expect(() => flatOffsetToPosition(paragraphs, 10)).toThrow(RangeError);
		expect(() => flatOffsetToPosition(paragraphs, -1)).toThrow(RangeError);
		expect(() => positionToFlatOffset(paragraphs, at(0, 5))).toThrow(RangeError);
		expect(() => positionToFlatOffset(paragraphs, at(7, 0))).toThrow(RangeError);
	});

	it('property: round trip for every offset', () => {
		fc.assert(
			fc.property(normalizedArbitrary, (generated) => {
				const total = plainText(generated).length;
				for (let flat = 0; flat <= total; flat += 1) {
					const position = flatOffsetToPosition(generated, flat);
					if (positionToFlatOffset(generated, position) !== flat) return false;
				}
				return true;
			})
		);
	});

	it('locates (paragraph, run, offset)', () => {
		const located = (paragraph: number, offset: number): RunLocation =>
			locateRun(paragraphs, at(paragraph, offset));
		expect(located(0, 0)).toEqual({ paragraph: 0, run: 0, offset: 0 });
		expect(located(0, 1)).toEqual({ paragraph: 0, run: 0, offset: 1 });
		expect(located(0, 2)).toEqual({ paragraph: 0, run: 0, offset: 2 });
		expect(located(0, 3)).toEqual({ paragraph: 0, run: 1, offset: 1 });
		expect(located(0, 4)).toEqual({ paragraph: 0, run: 1, offset: 2 });
		expect(located(1, 0)).toEqual({ paragraph: 1, run: null, offset: 0 });
	});
});

// ---------- insert / delete / split / join ----------

describe('insertText', () => {
	it('inserts inside a run without splitting it', () => {
		const result = insertText([paragraphOf(['hello', bold])], at(0, 2), 'XX');
		expect(result[0].runs).toEqual([{ text: 'heXXllo', style: bold }]);
	});

	it('inherits the style of the run before the caret, or the first run at the start', () => {
		const base = [paragraphOf(['ab', bold], ['cd'])];
		expect(insertText(base, at(0, 2), 'X')[0].runs).toEqual([
			{ text: 'abX', style: bold },
			{ text: 'cd', style: {} }
		]);
		expect(insertText(base, at(0, 0), 'X')[0].runs[0]).toEqual({ text: 'Xab', style: bold });
	});

	it('uses an explicit style, splitting around it', () => {
		const result = insertText([paragraphOf(['abcd'])], at(0, 2), 'X', bold);
		expect(result[0].runs).toEqual([
			{ text: 'ab', style: {} },
			{ text: 'X', style: bold },
			{ text: 'cd', style: {} }
		]);
	});

	it('types into an empty paragraph', () => {
		const result = insertText([paragraphOf()], at(0, 0), 'hi', bold);
		expect(result[0].runs).toEqual([{ text: 'hi', style: bold }]);
	});

	it('turns line breaks into paragraphs that copy the paragraph properties', () => {
		const source = { ...paragraphOf(['abcd', bold]), align: 'CENTER' as const };
		const result = insertText([source], at(0, 2), 'X\nY\r\nZ');
		expect(result.map((paragraph) => plainText([paragraph]))).toEqual(['abX', 'Y', 'Zcd']);
		expect(result.every((paragraph) => paragraph.align === 'CENTER')).toBe(true);
		expect(result[2].runs).toEqual([{ text: 'Zcd', style: bold }]);
	});

	it('ignores empty text and rejects bad positions', () => {
		expect(insertText([paragraphOf(['a'])], at(0, 0), '')).toEqual([paragraphOf(['a'])]);
		expect(() => insertText([paragraphOf(['a'])], at(0, 2), 'x')).toThrow(RangeError);
	});

	it('property: matches string insertion and stays normalized', () => {
		fc.assert(
			fc.property(
				normalizedArbitrary,
				fc.nat(),
				fc.string({ unit: fc.constantFrom('x', 'y', '\n'), maxLength: 4 }),
				(paragraphs, seed, inserted) => {
					const flatText = plainText(paragraphs);
					const flat = seed % (flatText.length + 1);
					const result = insertText(paragraphs, flatOffsetToPosition(paragraphs, flat), inserted);
					const expected = flatText.slice(0, flat) + inserted + flatText.slice(flat);
					return plainText(result) === expected && isNormalized(result);
				}
			)
		);
	});
});

describe('deleteRange', () => {
	it('deletes inside a paragraph, splitting a run', () => {
		const result = deleteRange([paragraphOf(['abcd', bold])], span(at(0, 1), at(0, 3)));
		expect(result[0].runs).toEqual([{ text: 'ad', style: bold }]);
	});

	it('merges the survivors of different runs when styles match', () => {
		const result = deleteRange(
			[paragraphOf(['ab'], ['cd', bold], ['ef'])],
			span(at(0, 2), at(0, 4))
		);
		expect(result[0].runs).toEqual([{ text: 'abef', style: {} }]);
	});

	it('across paragraphs joins head and tail and drops the middle', () => {
		const paragraphs = [paragraphOf(['abc']), paragraphOf(['mid']), paragraphOf(['xyz', bold])];
		const result = deleteRange(paragraphs, span(at(0, 1), at(2, 1)));
		expect(result).toHaveLength(1);
		expect(result[0].runs).toEqual([
			{ text: 'a', style: {} },
			{ text: 'yz', style: bold }
		]);
	});

	it('deleting a paragraph break joins the paragraphs and keeps the first one properties', () => {
		const first = { ...paragraphOf(['ab']), align: 'RIGHT' as const };
		const result = deleteRange([first, paragraphOf(['cd'])], span(at(0, 2), at(1, 0)));
		expect(plainText(result)).toBe('abcd');
		expect(result[0].align).toBe('RIGHT');
	});

	it('accepts a backwards range and an empty range', () => {
		expect(plainText(deleteRange([paragraphOf(['abcd'])], span(at(0, 3), at(0, 1))))).toBe('ad');
		expect(plainText(deleteRange([paragraphOf(['abcd'])], span(at(0, 2), at(0, 2))))).toBe('abcd');
	});

	it('deleting everything leaves one empty paragraph', () => {
		const result = deleteRange(
			[paragraphOf(['ab']), paragraphOf(['cd'])],
			span(at(0, 0), at(1, 2))
		);
		expect(result).toHaveLength(1);
		expect(result[0].runs).toEqual([]);
	});

	it('property: matches string deletion and stays normalized', () => {
		fc.assert(
			fc.property(withRange, ({ paragraphs, range }) => {
				const flatText = plainText(paragraphs);
				const start = positionToFlatOffset(paragraphs, range.start);
				const end = positionToFlatOffset(paragraphs, range.end);
				const result = deleteRange(paragraphs, range);
				return (
					plainText(result) === flatText.slice(0, start) + flatText.slice(end) &&
					isNormalized(result)
				);
			})
		);
	});
});

describe('splitParagraph and joinParagraphs', () => {
	it('splits in the middle of a run, keeping the style on both sides', () => {
		const result = splitParagraph([paragraphOf(['abcd', bold])], at(0, 2));
		expect(result.map((paragraph) => paragraph.runs)).toEqual([
			[{ text: 'ab', style: bold }],
			[{ text: 'cd', style: bold }]
		]);
	});

	it('splits at the edges into an empty paragraph', () => {
		expect(splitParagraph([paragraphOf(['ab'])], at(0, 0))[0].runs).toEqual([]);
		expect(splitParagraph([paragraphOf(['ab'])], at(0, 2))[1].runs).toEqual([]);
	});

	it('joins and re-merges runs that became equal', () => {
		const result = joinParagraphs([paragraphOf(['ab', bold]), paragraphOf(['cd', bold])], 0);
		expect(result).toHaveLength(1);
		expect(result[0].runs).toEqual([{ text: 'abcd', style: bold }]);
	});

	it('rejects joining the last paragraph', () => {
		expect(() => joinParagraphs([paragraphOf(['a'])], 0)).toThrow(RangeError);
	});

	it('property: join undoes split', () => {
		fc.assert(
			fc.property(normalizedArbitrary, fc.nat(), (paragraphs, seed) => {
				const total = plainText(paragraphs).length;
				const position = flatOffsetToPosition(paragraphs, seed % (total + 1));
				const joined = joinParagraphs(splitParagraph(paragraphs, position), position.paragraph);
				return deepEqual(joined, paragraphs);
			})
		);
	});
});

// ---------- styling ----------

describe('applyStyle', () => {
	it('splits runs at the range edges', () => {
		const result = applyStyle([paragraphOf(['abcdef'])], span(at(0, 2), at(0, 4)), bold);
		expect(result[0].runs).toEqual([
			{ text: 'ab', style: {} },
			{ text: 'cd', style: bold },
			{ text: 'ef', style: {} }
		]);
	});

	it('re-merges when the styled part joins an equal neighbour', () => {
		const start = [paragraphOf(['ab', bold], ['cd'])];
		const result = applyStyle(start, span(at(0, 2), at(0, 4)), bold);
		expect(result[0].runs).toEqual([{ text: 'abcd', style: bold }]);
	});

	it('adds to existing run styles instead of replacing them', () => {
		const result = applyStyle([paragraphOf(['abcd', italicFont])], span(at(0, 1), at(0, 3)), bold);
		expect(result[0].runs).toEqual([
			{ text: 'a', style: italicFont },
			{ text: 'bc', style: { ...italicFont, ...bold } },
			{ text: 'd', style: italicFont }
		]);
	});

	it('spans paragraphs', () => {
		const result = applyStyle(
			[paragraphOf(['abc']), paragraphOf(['def']), paragraphOf(['ghi'])],
			span(at(0, 1), at(2, 2)),
			bold
		);
		expect(result.map((paragraph) => paragraph.runs)).toEqual([
			[
				{ text: 'a', style: {} },
				{ text: 'bc', style: bold }
			],
			[{ text: 'def', style: bold }],
			[
				{ text: 'gh', style: bold },
				{ text: 'i', style: {} }
			]
		]);
	});

	it('an empty range changes nothing', () => {
		const start = normalizeParagraphs([paragraphOf(['abc'])]);
		expect(applyStyle(start, span(at(0, 1), at(0, 1)), bold)).toEqual(start);
	});

	it('property: only the covered characters change, text is untouched, result is normalized', () => {
		fc.assert(
			fc.property(withRange, styleArbitrary, ({ paragraphs, range }, style) => {
				const result = applyStyle(paragraphs, range, style);
				const start = positionToFlatOffset(paragraphs, range.start);
				const end = positionToFlatOffset(paragraphs, range.end);
				const before = characterStyles(paragraphs);
				const after = characterStyles(result);
				if (plainText(result) !== plainText(paragraphs) || !isNormalized(result)) return false;
				return after.every((style_, position) => {
					const previous = before[position];
					if (previous === null || style_ === null) return previous === style_;
					if (position < start || position >= end) return deepEqual(previous, style_);
					return deepEqual(
						style_,
						resolveStyle(defaultStyle, { ...stripToDelta(previous), ...style })
					);
				});
			})
		);
	});

	it('property: applying the same style twice equals applying it once', () => {
		fc.assert(
			fc.property(withRange, styleArbitrary, ({ paragraphs, range }, style) => {
				const once = applyStyle(paragraphs, range, style);
				return deepEqual(applyStyle(once, range, style), once);
			})
		);
	});
});

function stripToDelta(resolved: TextStyle): Partial<TextStyle> {
	return resolved;
}

describe('clearStyle', () => {
	it('removes the listed keys and re-merges', () => {
		const start = [paragraphOf(['ab'], ['cd', bold], ['ef'])];
		const result = clearStyle(start, span(at(0, 2), at(0, 4)), ['fontWeight']);
		expect(result[0].runs).toEqual([{ text: 'abcdef', style: {} }]);
	});

	it('removes everything when no keys are given, only inside the range', () => {
		const start = [paragraphOf(['abcd', { ...bold, ...italicFont }])];
		const result = clearStyle(start, span(at(0, 1), at(0, 3)));
		expect(result[0].runs).toEqual([
			{ text: 'a', style: { ...bold, ...italicFont } },
			{ text: 'bc', style: {} },
			{ text: 'd', style: { ...bold, ...italicFont } }
		]);
	});

	it('property: apply then clear of the same keys equals clear alone', () => {
		fc.assert(
			fc.property(withRange, ({ paragraphs, range }) => {
				const viaApply = clearStyle(applyStyle(paragraphs, range, bold), range, ['fontWeight']);
				const direct = clearStyle(paragraphs, range, ['fontWeight']);
				return deepEqual(viaApply, direct);
			})
		);
	});
});

describe('readStyle', () => {
	const paragraphs = normalizeParagraphs([
		paragraphOf(['ab', bold], ['cd', { fontSize: 24 }]),
		paragraphOf(['ef', bold])
	]);

	it('returns the common value and MIXED where runs differ', () => {
		const style = readStyle(paragraphs, span(at(0, 0), at(0, 4)), defaultStyle);
		expect(style.fontWeight).toBe(MIXED);
		expect(style.fontSize).toBe(MIXED);
		expect(style.fontName).toEqual(defaultStyle.fontName);
	});

	it('reads a uniform sub-range as plain values', () => {
		const style = readStyle(paragraphs, span(at(0, 0), at(0, 2)), defaultStyle);
		expect(style.fontWeight).toBe(700);
		expect(style.fontSize).toBe(defaultStyle.fontSize);
	});

	it('reads MIXED across paragraphs and for a bold plus default-weight mix', () => {
		expect(readStyle(paragraphs, span(at(0, 0), at(1, 2)), defaultStyle).fontWeight).toBe(MIXED);
		const mix = normalizeParagraphs([paragraphOf(['a', bold], ['b'])]);
		expect(readStyle(mix, span(at(0, 0), at(0, 2)), defaultStyle).fontWeight).toBe(MIXED);
	});

	it('treats an explicit value equal to the default as equal to an unset one', () => {
		const mix = normalizeParagraphs([paragraphOf(['a', { fontWeight: 400 }], ['b'])]);
		expect(readStyle(mix, span(at(0, 0), at(0, 2)), defaultStyle).fontWeight).toBe(400);
	});

	it('is MIXED for an optional property present on only some runs', () => {
		const mix = normalizeParagraphs([paragraphOf(['a', { textStyleId: 's' }], ['b'])]);
		const style = readStyle(mix, span(at(0, 0), at(0, 2)), defaultStyle);
		expect(style.textStyleId).toBe(MIXED);
	});

	it('reads the caret style for a collapsed range, preferring the run before it', () => {
		expect(readStyle(paragraphs, span(at(0, 2), at(0, 2)), defaultStyle).fontWeight).toBe(700);
		expect(readStyle(paragraphs, span(at(0, 3), at(0, 3)), defaultStyle).fontSize).toBe(24);
	});

	it('reads the default style where there is no text', () => {
		const empty = [paragraphOf()];
		expect(readStyle(empty, span(at(0, 0), at(0, 0)), defaultStyle)).toEqual(defaultStyle);
	});

	it('property: after applyStyle over a non-empty range, the applied keys read as plain values', () => {
		fc.assert(
			fc.property(withRange, ({ paragraphs: generated, range }) => {
				const flatStart = positionToFlatOffset(generated, range.start);
				const flatEnd = positionToFlatOffset(generated, range.end);
				const covered = plainText(generated).slice(flatStart, flatEnd).replaceAll('\n', '');
				if (covered === '') return true;
				const styled = applyStyle(generated, range, bold);
				return readStyle(styled, range, defaultStyle).fontWeight === 700;
			})
		);
	});
});

// ---------- Skia plan and changes ----------

describe('buildPlan', () => {
	it('emits pushStyle / addText / pop per run with resolved styles', () => {
		const plan = buildPlan([paragraphOf(['ab', bold], ['cd'])], defaultStyle);
		expect(plan).toHaveLength(1);
		expect(plan[0].steps.map((step) => step.op)).toEqual([
			'pushStyle',
			'addText',
			'pop',
			'pushStyle',
			'addText',
			'pop'
		]);
		expect(plan[0].steps[0]).toEqual({ op: 'pushStyle', style: { ...defaultStyle, ...bold } });
		expect(plan[0].steps[1]).toEqual({ op: 'addText', text: 'ab' });
		expect(plan[0].steps[3]).toEqual({ op: 'pushStyle', style: defaultStyle });
	});

	it('carries paragraph properties and keeps empty paragraphs measurable', () => {
		const plan = buildPlan(
			[{ ...emptyParagraph(), align: 'CENTER', list: 'ORDERED' }],
			defaultStyle
		);
		expect(plan[0]).toMatchObject({ align: 'CENTER', list: 'ORDERED', listLevel: 0 });
		expect(plan[0].steps).toEqual([
			{ op: 'pushStyle', style: defaultStyle },
			{ op: 'addText', text: '' },
			{ op: 'pop' }
		]);
	});

	it('keeps push and pop balanced and the text equal to the paragraph text', () => {
		fc.assert(
			fc.property(normalizedArbitrary, (generated) => {
				const plan = buildPlan(generated, defaultStyle);
				return plan.every((paragraphPlan, index) => {
					const pushes = paragraphPlan.steps.filter((step) => step.op === 'pushStyle').length;
					const pops = paragraphPlan.steps.filter((step) => step.op === 'pop').length;
					const joined = paragraphPlan.steps
						.map((step) => {
							if (step.op !== 'addText') return '';
							return step.text;
						})
						.join('');
					return pushes === pops && joined === plainText([generated[index]]);
				});
			})
		);
	});

	it('does not alias the input styles', () => {
		const source = [paragraphOf(['a', { fontSize: 30 }])];
		const plan = buildPlan(source, defaultStyle);
		const step = plan[0].steps[0];
		if (step.op !== 'pushStyle') throw new Error('expected pushStyle');
		step.style.fontSize = 99;
		expect(source[0].runs[0].style.fontSize).toBe(30);
		expect(defaultStyle.fontSize).toBe(16);
	});
});

describe('paragraphsChange', () => {
	it('is a set of paragraphs with the previous value, applicable and invertible in the store', () => {
		const node = createNode('TEXT', { id: 'n2', parentId: 'n1', index: 'a0' });
		const store = new DocumentStore(buildDocument([page('P', [textSpec({ id: node.id })])]));
		const original = store.requireNode('n2');
		if (original.type !== 'TEXT') throw new Error('expected TEXT');

		const edited = insertText(original.paragraphs, at(0, 0), 'Hello', bold);
		const change = paragraphsChange(original, edited);
		expect(change).toMatchObject({ t: 'set', id: 'n2' });
		store.apply(change);
		const after = store.requireNode('n2');
		expect(after.type === 'TEXT' && plainText(after.paragraphs)).toBe('Hello');
		expect(parseNode(after).ok).toBe(true);

		store.apply(invertChange(change));
		const reverted = store.requireNode('n2');
		expect(reverted.type === 'TEXT' && plainText(reverted.paragraphs)).toBe('');
	});

	it('produces paragraphs that pass the node schema after a sequence of edits', () => {
		let paragraphs = normalizeParagraphs([]);
		paragraphs = insertText(paragraphs, at(0, 0), 'Hello world', bold);
		paragraphs = applyStyle(paragraphs, span(at(0, 6), at(0, 11)), italicFont);
		paragraphs = insertText(paragraphs, at(0, 5), '\n');
		const node = createNode('TEXT', { paragraphs });
		expect(parseNode(node).ok).toBe(true);
		expect(plainText(paragraphs)).toBe('Hello\n world');
	});
});
