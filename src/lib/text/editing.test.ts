import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultTextStyle } from '../document/defaults';
import { deepEqual, paragraphLength, plainText } from '../document/text';
import type { Paragraph, TextStyle } from '../document/types';
import {
	adoptFragment,
	clampSelection,
	collapsedAt,
	deleteBackward,
	deleteForward,
	documentEnd,
	fragmentOf,
	insertParagraphBreak,
	pasteFragment,
	replaceSelection,
	resolveFragment,
	selectAll,
	selectParagraphAt,
	selectWordAt,
	selectedText,
	stepGrapheme,
	stepWord,
	type TextSelection
} from './editing';
import { paragraphOf } from './testing';

const BOLD: Partial<TextStyle> = { fontWeight: 700 };

function at(paragraph: number, offset: number): TextSelection {
	return collapsedAt({ paragraph, offset });
}

function between(start: [number, number], end: [number, number]): TextSelection {
	return {
		anchor: { paragraph: start[0], offset: start[1] },
		focus: { paragraph: end[0], offset: end[1] }
	};
}

function expectCanonical(paragraphs: Paragraph[]): void {
	expect(paragraphs.length).toBeGreaterThanOrEqual(1);
	for (const paragraph of paragraphs) {
		for (const run of paragraph.runs) expect(run.text).not.toBe('');
		for (let index = 1; index < paragraph.runs.length; index += 1) {
			expect(deepEqual(paragraph.runs[index - 1].style, paragraph.runs[index].style)).toBe(false);
		}
	}
}

describe('typing', () => {
	it('inserts at the caret and moves it after the text', () => {
		const result = replaceSelection([paragraphOf('held')], at(0, 2), 'llo wor');
		expect(plainText(result.paragraphs)).toBe('hello world');
		expect(result.selection).toEqual(at(0, 9));
	});

	it('replaces a selection and takes the style of the text it replaced', () => {
		const paragraphs = [
			{
				...paragraphOf(''),
				runs: [
					{ text: 'aa', style: {} },
					{ text: 'bb', style: BOLD }
				]
			}
		];
		const result = replaceSelection(paragraphs, between([0, 2], [0, 4]), 'X');
		expect(result.paragraphs[0].runs).toEqual([
			{ text: 'aa', style: {} },
			{ text: 'X', style: BOLD }
		]);
	});

	it('a typing style is the style of the text typed at a collapsed caret', () => {
		const result = replaceSelection([paragraphOf('ab')], at(0, 1), 'X', BOLD);
		expect(result.paragraphs[0].runs.map((run) => [run.text, run.style])).toEqual([
			['a', {}],
			['X', BOLD],
			['b', {}]
		]);
	});

	it('pasted line breaks start paragraphs and the caret lands in the last one', () => {
		const result = replaceSelection([paragraphOf('ab')], at(0, 1), 'x\ny\nz');
		expect(plainText(result.paragraphs)).toBe('ax\ny\nzb');
		expect(result.selection).toEqual(at(2, 1));
	});

	it('Enter splits the paragraph and keeps paragraph properties', () => {
		const paragraphs = [paragraphOf('hello', {}, { align: 'CENTER' })];
		const result = insertParagraphBreak(paragraphs, at(0, 2));
		expect(result.paragraphs.map((paragraph) => paragraph.align)).toEqual(['CENTER', 'CENTER']);
		expect(plainText(result.paragraphs)).toBe('he\nllo');
		expect(result.selection).toEqual(at(1, 0));
	});

	it('Enter in an empty list item ends the list instead of adding an item', () => {
		const paragraphs = [
			paragraphOf('a', {}, { list: 'UNORDERED' }),
			paragraphOf('', {}, { list: 'UNORDERED' })
		];
		const result = insertParagraphBreak(paragraphs, at(1, 0));
		expect(result.paragraphs).toHaveLength(2);
		expect(result.paragraphs[1].list).toBe('NONE');
	});
});

describe('deleting', () => {
	it('Backspace removes a whole grapheme: a surrogate pair and a combined emoji', () => {
		const emoji = '\u{1F469}‍\u{1F4BB}';
		const result = deleteBackward([paragraphOf(`a${emoji}`)], at(0, 1 + emoji.length));
		expect(plainText(result.paragraphs)).toBe('a');
		expect(result.selection).toEqual(at(0, 1));
	});

	it('Backspace at a paragraph start joins it to the previous one', () => {
		const result = deleteBackward([paragraphOf('ab'), paragraphOf('cd')], at(1, 0));
		expect(plainText(result.paragraphs)).toBe('abcd');
		expect(result.selection).toEqual(at(0, 2));
	});

	it('Backspace at the start of a list item removes the list first, then joins', () => {
		const paragraphs = [
			paragraphOf('ab'),
			paragraphOf('cd', {}, { list: 'ORDERED', listLevel: 1 })
		];
		const first = deleteBackward(paragraphs, at(1, 0));
		expect(first.paragraphs[1]).toMatchObject({ list: 'NONE', listLevel: 0 });
		expect(first.paragraphs).toHaveLength(2);
		expect(deleteBackward(first.paragraphs, first.selection).paragraphs).toHaveLength(1);
	});

	it('Backspace at the very start does nothing', () => {
		const paragraphs = [paragraphOf('ab')];
		expect(deleteBackward(paragraphs, at(0, 0)).paragraphs).toBe(paragraphs);
	});

	it('Ctrl+Backspace deletes the word before the caret', () => {
		const result = deleteBackward([paragraphOf('one two three')], at(0, 7), 'word');
		expect(plainText(result.paragraphs)).toBe('one  three');
		expect(result.selection).toEqual(at(0, 4));
	});

	it('Delete removes forward and joins at the paragraph end', () => {
		expect(plainText(deleteForward([paragraphOf('abc')], at(0, 1)).paragraphs)).toBe('ac');
		expect(
			plainText(deleteForward([paragraphOf('ab'), paragraphOf('cd')], at(0, 2)).paragraphs)
		).toBe('abcd');
		const lastEnd = [paragraphOf('ab')];
		expect(deleteForward(lastEnd, at(0, 2)).paragraphs).toBe(lastEnd);
	});

	it('deleting everything leaves one empty paragraph', () => {
		const paragraphs = [paragraphOf('ab'), paragraphOf('cd')];
		const result = deleteBackward(paragraphs, selectAll(paragraphs));
		expect(result.paragraphs).toHaveLength(1);
		expect(paragraphLength(result.paragraphs[0])).toBe(0);
		expect(result.paragraphs[0].runs).toEqual([]);
	});
});

describe('moving and selecting', () => {
	const paragraphs = [paragraphOf('one two'), paragraphOf('three')];

	it('steps across paragraph boundaries and stops at the document edges', () => {
		expect(stepGrapheme(paragraphs, { paragraph: 0, offset: 7 }, 1)).toEqual({
			paragraph: 1,
			offset: 0
		});
		expect(stepGrapheme(paragraphs, { paragraph: 1, offset: 0 }, -1)).toEqual({
			paragraph: 0,
			offset: 7
		});
		expect(stepGrapheme(paragraphs, { paragraph: 0, offset: 0 }, -1)).toEqual({
			paragraph: 0,
			offset: 0
		});
		expect(stepGrapheme(paragraphs, documentEnd(paragraphs), 1)).toEqual(documentEnd(paragraphs));
	});

	it('Ctrl+arrow moves by word', () => {
		expect(stepWord(paragraphs, { paragraph: 0, offset: 0 }, 1)).toEqual({
			paragraph: 0,
			offset: 3
		});
		expect(stepWord(paragraphs, { paragraph: 0, offset: 3 }, 1)).toEqual({
			paragraph: 0,
			offset: 7
		});
		expect(stepWord(paragraphs, { paragraph: 0, offset: 7 }, -1)).toEqual({
			paragraph: 0,
			offset: 4
		});
		expect(stepWord(paragraphs, { paragraph: 0, offset: 4 }, -1)).toEqual({
			paragraph: 0,
			offset: 0
		});
	});

	it('double click selects a word and triple click the paragraph', () => {
		expect(selectWordAt(paragraphs, { paragraph: 0, offset: 5 })).toEqual(between([0, 4], [0, 7]));
		expect(selectParagraphAt(paragraphs, { paragraph: 1, offset: 2 })).toEqual(
			between([1, 0], [1, 5])
		);
	});

	it('Ctrl+A selects all', () => {
		expect(selectAll(paragraphs)).toEqual(between([0, 0], [1, 5]));
	});

	it('clamps a stale selection after the text shrank', () => {
		expect(clampSelection([paragraphOf('ab')], between([3, 9], [0, 7]))).toEqual(
			between([0, 2], [0, 2])
		);
	});
});

describe('clipboard', () => {
	const styled: Paragraph[] = [
		{
			...paragraphOf(''),
			runs: [
				{ text: 'plain ', style: {} },
				{ text: 'bold', style: BOLD }
			]
		},
		paragraphOf('second', {}, { list: 'UNORDERED' })
	];

	it('copies plain text across paragraphs', () => {
		expect(selectedText(styled, between([0, 2], [1, 3]))).toBe('ain bold\nsec');
	});

	it('copies the runs with their styles and paragraph properties', () => {
		const fragment = fragmentOf(styled, between([0, 3], [1, 3]));
		expect(fragment[0].runs).toEqual([
			{ text: 'in ', style: {} },
			{ text: 'bold', style: BOLD }
		]);
		expect(fragment[1].list).toBe('UNORDERED');
		expect(fragment[1].runs[0].text).toBe('sec');
	});

	it('pastes a single paragraph fragment inline with its styles', () => {
		const fragment = fragmentOf(styled, between([0, 6], [0, 10]));
		const result = pasteFragment([paragraphOf('ab')], at(0, 1), fragment);
		expect(plainText(result.paragraphs)).toBe('aboldb');
		expect(result.paragraphs[0].runs.map((run) => run.text)).toEqual(['a', 'bold', 'b']);
		expect(result.selection).toEqual(at(0, 5));
	});

	it('pastes several paragraphs, the last one joined to the rest of the target', () => {
		const fragment = fragmentOf(styled, between([0, 6], [1, 3]));
		const result = pasteFragment([paragraphOf('xy')], at(0, 1), fragment);
		expect(plainText(result.paragraphs)).toBe('xbold\nsecy');
		expect(result.paragraphs[1].list).toBe('UNORDERED');
		expect(result.selection).toEqual(at(1, 3));
		expectCanonical(result.paragraphs);
	});

	it('pasting over a selection replaces it', () => {
		const result = pasteFragment([paragraphOf('hello world')], between([0, 0], [0, 5]), [
			paragraphOf('bye')
		]);
		expect(plainText(result.paragraphs)).toBe('bye world');
	});

	it('a fragment moved to a node with another default style keeps its look', () => {
		const source = defaultTextStyle();
		const target: TextStyle = { ...defaultTextStyle(), fontSize: 32 };
		const resolved = resolveFragment(
			[
				{
					...paragraphOf(''),
					runs: [
						{ text: 'x', style: { fontSize: 32 } },
						{ text: 'y', style: {} }
					]
				}
			],
			source
		);
		const adopted = adoptFragment(resolved, target);
		expect(adopted[0].runs).toEqual([
			{ text: 'x', style: {} },
			{ text: 'y', style: { fontSize: 16 } }
		]);
	});
});

describe('properties', () => {
	const operation = fc.oneof(
		fc.record({
			kind: fc.constant('type' as const),
			text: fc.string({ maxLength: 6 }),
			bold: fc.boolean()
		}),
		fc.constant({ kind: 'enter' as const }),
		fc.constant({ kind: 'back' as const }),
		fc.constant({ kind: 'forward' as const }),
		fc.constant({ kind: 'word-back' as const }),
		fc.record({
			kind: fc.constant('move' as const),
			direction: fc.constantFrom(-1 as const, 1 as const)
		}),
		fc.record({
			kind: fc.constant('select' as const),
			direction: fc.constantFrom(-1 as const, 1 as const)
		})
	);

	it('any sequence of edits keeps the paragraphs canonical and the caret valid', () => {
		fc.assert(
			fc.property(fc.array(operation, { maxLength: 40 }), (operations) => {
				let paragraphs: Paragraph[] = [paragraphOf('')];
				let selection = at(0, 0);
				for (const step of operations) {
					let result = { paragraphs, selection };
					if (step.kind === 'type') {
						result = replaceSelection(
							paragraphs,
							selection,
							step.text,
							step.bold ? BOLD : undefined
						);
					}
					if (step.kind === 'enter') result = insertParagraphBreak(paragraphs, selection);
					if (step.kind === 'back') result = deleteBackward(paragraphs, selection);
					if (step.kind === 'forward') result = deleteForward(paragraphs, selection);
					if (step.kind === 'word-back') result = deleteBackward(paragraphs, selection, 'word');
					if (step.kind === 'move') {
						result.selection = collapsedAt(
							stepGrapheme(paragraphs, selection.focus, step.direction)
						);
					}
					if (step.kind === 'select') {
						result.selection = {
							anchor: selection.anchor,
							focus: stepWord(paragraphs, selection.focus, step.direction)
						};
					}
					paragraphs = result.paragraphs;
					selection = result.selection;
					expectCanonical(paragraphs);
					for (const position of [selection.anchor, selection.focus]) {
						const paragraph = paragraphs[position.paragraph];
						expect(paragraph).toBeDefined();
						expect(position.offset).toBeLessThanOrEqual(paragraphLength(paragraph));
					}
				}
			}),
			{ numRuns: 200 }
		);
	});

	it('typing then Backspace as often restores the text', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 12 }),
				fc.string({ maxLength: 8 }),
				(base, typed) => {
					const text = base.replace(/\s/g, ' ');
					const word = typed.replace(/\s/g, 'x');
					const paragraphs = [paragraphOf(text)];
					const caret = at(0, text.length);
					const inserted = replaceSelection(paragraphs, caret, word);
					let current: { paragraphs: Paragraph[]; selection: TextSelection } = inserted;
					for (let count = 0; count < word.length; count += 1) {
						current = deleteBackward(current.paragraphs, current.selection);
					}
					expect(plainText(current.paragraphs)).toBe(text);
				}
			)
		);
	});
});
