// The text editing engine: pure operations on paragraphs of runs and a selection. No DOM, no
// layout, no kernel. Every operation takes `Paragraph[]` plus a `TextSelection` and returns the
// new, normalized paragraphs plus where the selection ends up; inputs are never mutated.
//
// Built on the run operations of document/text.ts (`insertText`, `deleteRange`, ... which keep
// the structure canonical: no empty runs, no mergeable neighbours, at least one paragraph). What
// this module adds is what an editor needs on top: moving by grapheme and word, word and
// paragraph selection, backspace / delete semantics, list handling on Enter and Backspace, and
// the clipboard fragment (copy, cut, rich paste).
//
// Positions are `{ paragraph, offset }` with UTF-16 offsets, as in document/text.ts.
// Movement that needs geometry (up / down, line Home / End) belongs to the layout service.

import {
	comparePositions,
	deleteRange,
	deepEqual,
	insertText,
	locateRun,
	normalizeParagraphs,
	orderRange,
	paragraphLength,
	paragraphText,
	plainText,
	resolveStyle,
	sliceRuns,
	type TextPosition,
	type TextRange
} from '../document/text';
import type { Paragraph, TextRun, TextStyle } from '../document/types';

export interface TextSelection {
	/** Where the selection started (stays put while it is extended). */
	anchor: TextPosition;
	/** The caret: the end that moves. */
	focus: TextPosition;
}

export interface EditResult {
	paragraphs: Paragraph[];
	selection: TextSelection;
}

export type DeleteUnit = 'grapheme' | 'word' | 'paragraph';

// ---------- selections ----------

export function collapsedAt(position: TextPosition): TextSelection {
	return { anchor: position, focus: position };
}

export function isCollapsed(selection: TextSelection): boolean {
	return comparePositions(selection.anchor, selection.focus) === 0;
}

/** The selected range with start before end. */
export function selectionRange(selection: TextSelection): TextRange {
	return orderRange({ start: selection.anchor, end: selection.focus });
}

export function documentStart(): TextPosition {
	return { paragraph: 0, offset: 0 };
}

export function documentEnd(paragraphs: Paragraph[]): TextPosition {
	const last = paragraphs.length - 1;
	return { paragraph: last, offset: paragraphLength(paragraphs[last]) };
}

export function selectAll(paragraphs: Paragraph[]): TextSelection {
	return { anchor: documentStart(), focus: documentEnd(paragraphs) };
}

/** `position` moved to the nearest valid place; used after undo, redo and external edits. */
export function clampPosition(paragraphs: Paragraph[], position: TextPosition): TextPosition {
	const paragraph = Math.min(Math.max(position.paragraph, 0), paragraphs.length - 1);
	const length = paragraphLength(paragraphs[paragraph]);
	return { paragraph, offset: Math.min(Math.max(position.offset, 0), length) };
}

export function clampSelection(paragraphs: Paragraph[], selection: TextSelection): TextSelection {
	return {
		anchor: clampPosition(paragraphs, selection.anchor),
		focus: clampPosition(paragraphs, selection.focus)
	};
}

/** Extend the selection to `focus` (Shift+arrow, drag) or collapse it there. */
export function moveFocus(
	selection: TextSelection,
	focus: TextPosition,
	extend: boolean
): TextSelection {
	if (extend) return { anchor: selection.anchor, focus };
	return collapsedAt(focus);
}

// ---------- boundaries ----------

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Offsets of the grapheme boundaries of `text`, including 0 and the length. */
function graphemeBoundaries(text: string): number[] {
	const boundaries = [0];
	for (const part of graphemes.segment(text)) boundaries.push(part.index + part.segment.length);
	return boundaries;
}

function previousBoundary(boundaries: number[], offset: number): number {
	let previous = 0;
	for (const boundary of boundaries) {
		if (boundary >= offset) return previous;
		previous = boundary;
	}
	return previous;
}

function nextBoundary(boundaries: number[], offset: number): number {
	for (const boundary of boundaries) {
		if (boundary > offset) return boundary;
	}
	return offset;
}

/** One grapheme left or right; crosses into the neighbouring paragraph at its edges. */
export function stepGrapheme(
	paragraphs: Paragraph[],
	position: TextPosition,
	direction: -1 | 1
): TextPosition {
	const text = paragraphText(paragraphs[position.paragraph]);
	if (direction < 0) {
		if (position.offset === 0) return endOfParagraphBefore(paragraphs, position);
		const offset = previousBoundary(graphemeBoundaries(text), position.offset);
		return { paragraph: position.paragraph, offset };
	}
	if (position.offset >= text.length) return startOfParagraphAfter(paragraphs, position);
	const offset = nextBoundary(graphemeBoundaries(text), position.offset);
	return { paragraph: position.paragraph, offset };
}

function endOfParagraphBefore(paragraphs: Paragraph[], position: TextPosition): TextPosition {
	if (position.paragraph === 0) return position;
	const paragraph = position.paragraph - 1;
	return { paragraph, offset: paragraphLength(paragraphs[paragraph]) };
}

function startOfParagraphAfter(paragraphs: Paragraph[], position: TextPosition): TextPosition {
	if (position.paragraph >= paragraphs.length - 1) return position;
	return { paragraph: position.paragraph + 1, offset: 0 };
}

interface WordSpan {
	start: number;
	end: number;
}

function wordSpans(text: string): WordSpan[] {
	const spans: WordSpan[] = [];
	for (const part of words.segment(text)) {
		if (!part.isWordLike) continue;
		spans.push({ start: part.index, end: part.index + part.segment.length });
	}
	return spans;
}

/** Ctrl+Left / Ctrl+Right: to the start of the previous word or the end of the next one. */
export function stepWord(
	paragraphs: Paragraph[],
	position: TextPosition,
	direction: -1 | 1
): TextPosition {
	const text = paragraphText(paragraphs[position.paragraph]);
	const spans = wordSpans(text);
	if (direction < 0) {
		if (position.offset === 0) return endOfParagraphBefore(paragraphs, position);
		const before = spans.filter((span) => span.start < position.offset);
		const target = before.length === 0 ? 0 : before[before.length - 1].start;
		return { paragraph: position.paragraph, offset: target };
	}
	if (position.offset >= text.length) return startOfParagraphAfter(paragraphs, position);
	const after = spans.find((span) => span.end > position.offset);
	const target = after ? after.end : text.length;
	return { paragraph: position.paragraph, offset: target };
}

export function paragraphStart(position: TextPosition): TextPosition {
	return { paragraph: position.paragraph, offset: 0 };
}

export function paragraphEnd(paragraphs: Paragraph[], position: TextPosition): TextPosition {
	return {
		paragraph: position.paragraph,
		offset: paragraphLength(paragraphs[position.paragraph])
	};
}

/** The word under `position` (double click); the whitespace run or symbol there when no word. */
export function selectWordAt(paragraphs: Paragraph[], position: TextPosition): TextSelection {
	const text = paragraphText(paragraphs[position.paragraph]);
	if (text.length === 0) return collapsedAt(position);
	const probe = Math.min(position.offset, text.length - 1);
	for (const part of words.segment(text)) {
		const end = part.index + part.segment.length;
		if (probe < part.index || probe >= end) continue;
		return {
			anchor: { paragraph: position.paragraph, offset: part.index },
			focus: { paragraph: position.paragraph, offset: end }
		};
	}
	return collapsedAt(position);
}

/** The whole paragraph (triple click). */
export function selectParagraphAt(paragraphs: Paragraph[], position: TextPosition): TextSelection {
	return {
		anchor: paragraphStart(position),
		focus: paragraphEnd(paragraphs, position)
	};
}

// ---------- typing style ----------

/** The style delta of the run holding `position`: what a character typed there would get. */
export function styleAt(paragraphs: Paragraph[], position: TextPosition): Partial<TextStyle> {
	const location = locateRun(paragraphs, position);
	if (location.run === null) return {};
	return paragraphs[position.paragraph].runs[location.run].style;
}

// ---------- editing ----------

/** Typing over a selection continues the style of its first character, like browsers do. */
function styleOfFirstSelected(
	paragraphs: Paragraph[],
	selection: TextSelection
): Partial<TextStyle> {
	const { start } = selectionRange(selection);
	const hasCharacter =
		!isCollapsed(selection) && start.offset < paragraphLength(paragraphs[start.paragraph]);
	if (!hasCharacter) return styleAt(paragraphs, start);
	return styleAt(paragraphs, { paragraph: start.paragraph, offset: start.offset + 1 });
}

function afterInsert(paragraphs: Paragraph[], start: TextPosition, text: string): TextPosition {
	const lines = text.split(/\r\n|\r|\n/);
	if (lines.length === 1) return { paragraph: start.paragraph, offset: start.offset + text.length };
	const last = lines[lines.length - 1];
	return { paragraph: start.paragraph + lines.length - 1, offset: last.length };
}

/**
 * Replace the selection with `text` (line breaks start paragraphs). `typingStyle` is the style
 * delta pending on a collapsed caret (Ctrl+B with nothing selected); it is the complete style of
 * the new text, built from the caret's own style plus the change.
 */
export function replaceSelection(
	paragraphs: Paragraph[],
	selection: TextSelection,
	text: string,
	typingStyle?: Partial<TextStyle>
): EditResult {
	const range = selectionRange(selection);
	const removed = isCollapsed(selection) ? paragraphs : deleteRange(paragraphs, range);
	const style =
		typingStyle === undefined ? styleOfFirstSelected(paragraphs, selection) : typingStyle;
	const result = insertText(removed, range.start, text, style);
	return { paragraphs: result, selection: collapsedAt(afterInsert(result, range.start, text)) };
}

/** Delete the selection; collapses to its start. */
export function deleteSelection(paragraphs: Paragraph[], selection: TextSelection): EditResult {
	const range = selectionRange(selection);
	if (isCollapsed(selection)) return { paragraphs, selection };
	return { paragraphs: deleteRange(paragraphs, range), selection: collapsedAt(range.start) };
}

function withListCleared(paragraphs: Paragraph[], index: number): Paragraph[] {
	return paragraphs.map((paragraph, position) => {
		if (position !== index) return paragraph;
		return { ...paragraph, list: 'NONE', listLevel: 0 };
	});
}

/**
 * Backspace. A selection is deleted; at the start of a list item the list marker goes first;
 * otherwise one grapheme, word or paragraph back, joining paragraphs at their boundary.
 */
export function deleteBackward(
	paragraphs: Paragraph[],
	selection: TextSelection,
	unit: DeleteUnit = 'grapheme'
): EditResult {
	if (!isCollapsed(selection)) return deleteSelection(paragraphs, selection);
	const caret = selection.focus;
	const atStart = caret.offset === 0;
	if (atStart && paragraphs[caret.paragraph].list !== 'NONE') {
		return { paragraphs: withListCleared(paragraphs, caret.paragraph), selection };
	}
	if (atStart && caret.paragraph === 0) return { paragraphs, selection };
	const target = backwardTarget(paragraphs, caret, unit);
	return {
		paragraphs: deleteRange(paragraphs, { start: target, end: caret }),
		selection: collapsedAt(target)
	};
}

function backwardTarget(
	paragraphs: Paragraph[],
	caret: TextPosition,
	unit: DeleteUnit
): TextPosition {
	if (caret.offset === 0) return stepGrapheme(paragraphs, caret, -1);
	if (unit === 'paragraph') return paragraphStart(caret);
	if (unit === 'word') return stepWord(paragraphs, caret, -1);
	return stepGrapheme(paragraphs, caret, -1);
}

/** Delete: one grapheme, word or the rest of the paragraph forward. */
export function deleteForward(
	paragraphs: Paragraph[],
	selection: TextSelection,
	unit: DeleteUnit = 'grapheme'
): EditResult {
	if (!isCollapsed(selection)) return deleteSelection(paragraphs, selection);
	const caret = selection.focus;
	const atEnd = caret.offset >= paragraphLength(paragraphs[caret.paragraph]);
	if (atEnd && caret.paragraph === paragraphs.length - 1) return { paragraphs, selection };
	let target = stepGrapheme(paragraphs, caret, 1);
	if (!atEnd && unit === 'word') target = stepWord(paragraphs, caret, 1);
	if (!atEnd && unit === 'paragraph') target = paragraphEnd(paragraphs, caret);
	return {
		paragraphs: deleteRange(paragraphs, { start: caret, end: target }),
		selection: collapsedAt(caret)
	};
}

/**
 * Enter. Splits the paragraph at the caret (replacing the selection). Pressing it in an empty
 * list item ends the list instead, as every editor does.
 */
export function insertParagraphBreak(
	paragraphs: Paragraph[],
	selection: TextSelection,
	typingStyle?: Partial<TextStyle>
): EditResult {
	const caret = selection.focus;
	const paragraph = paragraphs[caret.paragraph];
	const emptyListItem =
		isCollapsed(selection) && paragraph.list !== 'NONE' && paragraphLength(paragraph) === 0;
	if (emptyListItem) {
		return { paragraphs: withListCleared(paragraphs, caret.paragraph), selection };
	}
	return replaceSelection(paragraphs, selection, '\n', typingStyle);
}

// ---------- clipboard ----------

/** Plain text of the selection, paragraphs separated by line feeds. */
export function selectedText(paragraphs: Paragraph[], selection: TextSelection): string {
	return plainText(fragmentOf(paragraphs, selection));
}

/** The selected part as paragraphs, runs and paragraph properties intact. */
export function fragmentOf(paragraphs: Paragraph[], selection: TextSelection): Paragraph[] {
	const { start, end } = selectionRange(selection);
	const slice: Paragraph[] = [];
	for (let index = start.paragraph; index <= end.paragraph; index += 1) {
		const paragraph = paragraphs[index];
		const from = index === start.paragraph ? start.offset : 0;
		const to = index === end.paragraph ? end.offset : paragraphLength(paragraph);
		slice.push({
			...structuredClone({ ...paragraph, runs: [] }),
			runs: sliceRuns(paragraph.runs, from, to)
		});
	}
	return normalizeParagraphs(slice);
}

/** Every run with its complete style, so a fragment means the same in another text node. */
export function resolveFragment(fragment: Paragraph[], defaultStyle: TextStyle): Paragraph[] {
	return fragment.map((paragraph) => ({
		...paragraph,
		runs: paragraph.runs.map((run) => ({
			text: run.text,
			style: resolveStyle(defaultStyle, run.style)
		}))
	}));
}

function deltaOver(defaultStyle: TextStyle, full: Partial<TextStyle>): Partial<TextStyle> {
	const delta: Record<string, unknown> = {};
	const base = defaultStyle as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(full)) {
		if (value === undefined) continue;
		if (!deepEqual(base[key], value)) delta[key] = structuredClone(value);
	}
	return delta as Partial<TextStyle>;
}

/** The inverse of `resolveFragment` for the destination node's default style. */
export function adoptFragment(fragment: Paragraph[], defaultStyle: TextStyle): Paragraph[] {
	return fragment.map((paragraph) => ({
		...paragraph,
		runs: paragraph.runs.map((run) => ({
			text: run.text,
			style: deltaOver(defaultStyle, run.style)
		}))
	}));
}

/** Paste `fragment` over the selection, keeping its runs and, for several paragraphs, theirs. */
export function pasteFragment(
	paragraphs: Paragraph[],
	selection: TextSelection,
	fragment: Paragraph[]
): EditResult {
	const range = selectionRange(selection);
	const base = isCollapsed(selection) ? paragraphs : deleteRange(paragraphs, range);
	const position = range.start;
	const target = base[position.paragraph];
	const head = sliceRuns(target.runs, 0, position.offset);
	const tail = sliceRuns(target.runs, position.offset, paragraphLength(target));
	const pieces = fragment.map((paragraph) => structuredClone(paragraph));
	const lastIndex = pieces.length - 1;

	const built: Paragraph[] = pieces.map((piece, index) => {
		const runs: TextRun[] = [];
		if (index === 0) runs.push(...head);
		runs.push(...piece.runs);
		if (index === lastIndex) runs.push(...tail);
		const takesTargetProperties = index === 0 && (lastIndex === 0 || head.length > 0);
		if (takesTargetProperties) return { ...piece, ...propertiesOf(target), runs };
		return { ...piece, runs };
	});
	const result = normalizeParagraphs([
		...base.slice(0, position.paragraph),
		...built,
		...base.slice(position.paragraph + 1)
	]);
	const lastFragment = fragment[lastIndex];
	const caret: TextPosition = {
		paragraph: position.paragraph + lastIndex,
		offset: (lastIndex === 0 ? position.offset : 0) + paragraphLength(lastFragment)
	};
	return { paragraphs: result, selection: collapsedAt(caret) };
}

function propertiesOf(paragraph: Paragraph): Omit<Paragraph, 'runs'> {
	return {
		align: paragraph.align,
		indent: paragraph.indent,
		spacingAfter: paragraph.spacingAfter,
		list: paragraph.list,
		listLevel: paragraph.listLevel
	};
}
