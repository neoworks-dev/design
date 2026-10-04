// Pure text editing: paragraphs of styled runs (data-model.md section 3 and provisional 7).
//
// Every operation takes `Paragraph[]` and returns a new, normalized `Paragraph[]`; inputs are
// never mutated. Normalization keeps the structure canonical after every edit: empty runs are
// dropped, adjacent runs whose styles are deep-equal are merged, and there is always at least one
// paragraph. A run style is a delta over the node's `defaultStyle`; `textStyleId` and
// `boundVariables` live inside it, so runs that differ in either are never merged.
//
// Offsets are UTF-16 code units, like JavaScript strings and DOM selections. Callers that move a
// caret by grapheme must step over surrogate pairs themselves. A paragraph with no text has no
// runs, so the style a caret would type with in an empty paragraph is not stored; the text tool
// passes it as `style` to `insertText`.

import type { Change, Paragraph, TextNode, TextRun, TextStyle } from './types';

export const MIXED: unique symbol = Symbol('mixed');
export type Mixed = typeof MIXED;

export interface TextPosition {
	/** Index into the paragraph list. */
	paragraph: number;
	/** Character offset inside that paragraph. */
	offset: number;
}
export interface TextRange {
	start: TextPosition;
	end: TextPosition;
}
export interface RunLocation {
	paragraph: number;
	/** Index of the run holding the position; `null` for an empty paragraph. */
	run: number | null;
	/** Offset inside that run. At a run boundary the earlier run (offset = its length) wins. */
	offset: number;
}

/** Style of a range with `MIXED` for every property whose value differs across the range. */
export type RangeStyle = { [Key in keyof TextStyle]?: TextStyle[Key] | Mixed };

// ---------- equality and styles ----------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON-like values; an `undefined` property equals a missing one. */
export function deepEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		return left.every((item, position) => deepEqual(item, right[position]));
	}
	if (isPlainObject(left) && isPlainObject(right)) {
		const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
		for (const key of keys) {
			if (!deepEqual(left[key], right[key])) return false;
		}
		return true;
	}
	return false;
}

function definedEntries(style: Partial<TextStyle>): [string, unknown][] {
	return Object.entries(style).filter(([, value]) => value !== undefined);
}

function cleanStyle(style: Partial<TextStyle>): Partial<TextStyle> {
	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of definedEntries(style)) cleaned[key] = structuredClone(value);
	return cleaned as Partial<TextStyle>;
}

/** The effective style of a run: `defaultStyle` with the run's delta on top. */
export function resolveStyle(defaultStyle: TextStyle, delta: Partial<TextStyle>): TextStyle {
	const resolved: Record<string, unknown> = { ...defaultStyle };
	for (const [key, value] of definedEntries(delta)) resolved[key] = value;
	return resolved as unknown as TextStyle;
}

// ---------- normalization ----------

export function emptyParagraph(template?: Paragraph): Paragraph {
	const base: Paragraph = {
		runs: [],
		align: 'LEFT',
		indent: 0,
		spacingAfter: 0,
		list: 'NONE',
		listLevel: 0
	};
	if (!template) return base;
	return { ...base, ...structuredClone({ ...template, runs: [] }) };
}

function normalizeRuns(runs: TextRun[]): TextRun[] {
	const result: TextRun[] = [];
	for (const run of runs) {
		if (run.text === '') continue;
		const style = cleanStyle(run.style);
		const previous = result[result.length - 1];
		if (previous && deepEqual(previous.style, style)) {
			result[result.length - 1] = { text: previous.text + run.text, style: previous.style };
			continue;
		}
		result.push({ text: run.text, style });
	}
	return result;
}

/** Canonical form: no empty runs, no mergeable neighbours, at least one paragraph. */
export function normalizeParagraphs(paragraphs: Paragraph[]): Paragraph[] {
	if (paragraphs.length === 0) return [emptyParagraph()];
	return paragraphs.map((paragraph) => ({
		...structuredClone({ ...paragraph, runs: [] }),
		runs: normalizeRuns(paragraph.runs)
	}));
}

// ---------- text and position mapping ----------

export function paragraphLength(paragraph: Paragraph): number {
	return paragraph.runs.reduce((total, run) => total + run.text.length, 0);
}

export function paragraphText(paragraph: Paragraph): string {
	return paragraph.runs.map((run) => run.text).join('');
}

/** All text, paragraphs separated by a single `\n`. */
export function plainText(paragraphs: Paragraph[]): string {
	return paragraphs.map(paragraphText).join('\n');
}

function assertPosition(paragraphs: Paragraph[], position: TextPosition): void {
	const paragraph = paragraphs[position.paragraph];
	if (!paragraph) throw new RangeError(`no paragraph ${position.paragraph}`);
	const length = paragraphLength(paragraph);
	if (!Number.isInteger(position.offset) || position.offset < 0 || position.offset > length) {
		throw new RangeError(`offset ${position.offset} outside paragraph of length ${length}`);
	}
}

export function comparePositions(left: TextPosition, right: TextPosition): number {
	if (left.paragraph !== right.paragraph) return left.paragraph - right.paragraph;
	return left.offset - right.offset;
}

/** The same range with start before end. */
export function orderRange(range: TextRange): TextRange {
	if (comparePositions(range.start, range.end) <= 0) return range;
	return { start: range.end, end: range.start };
}

/** Flat character offset (paragraph breaks count as one character) of a position. */
export function positionToFlatOffset(paragraphs: Paragraph[], position: TextPosition): number {
	assertPosition(paragraphs, position);
	let flat = 0;
	for (let index = 0; index < position.paragraph; index += 1) {
		flat += paragraphLength(paragraphs[index]) + 1;
	}
	return flat + position.offset;
}

export function flatOffsetToPosition(paragraphs: Paragraph[], flatOffset: number): TextPosition {
	if (!Number.isInteger(flatOffset) || flatOffset < 0) {
		throw new RangeError(`invalid flat offset ${flatOffset}`);
	}
	let remaining = flatOffset;
	for (let index = 0; index < paragraphs.length; index += 1) {
		const length = paragraphLength(paragraphs[index]);
		if (remaining <= length) return { paragraph: index, offset: remaining };
		remaining -= length + 1;
	}
	throw new RangeError(`flat offset ${flatOffset} beyond the end of the text`);
}

export function flatRange(paragraphs: Paragraph[], start: number, end: number): TextRange {
	return {
		start: flatOffsetToPosition(paragraphs, start),
		end: flatOffsetToPosition(paragraphs, end)
	};
}

/** Where a position falls in the run structure, for caret style lookup and IME composition. */
export function locateRun(paragraphs: Paragraph[], position: TextPosition): RunLocation {
	assertPosition(paragraphs, position);
	const paragraph = paragraphs[position.paragraph];
	if (paragraph.runs.length === 0) return { paragraph: position.paragraph, run: null, offset: 0 };
	let runStart = 0;
	for (let run = 0; run < paragraph.runs.length; run += 1) {
		const runEnd = runStart + paragraph.runs[run].text.length;
		if (position.offset <= runEnd) {
			return { paragraph: position.paragraph, run, offset: position.offset - runStart };
		}
		runStart = runEnd;
	}
	throw new Error('unreachable: position was validated');
}

// ---------- run helpers ----------

function makeRun(text: string, style: Partial<TextStyle>): TextRun {
	return { text, style: cleanStyle(style) };
}

/** Runs of `runs` split at `from` and `to`; `change` is applied to the part inside. */
function mapRunsInRange(
	runs: TextRun[],
	from: number,
	to: number,
	change: (style: Partial<TextStyle>) => Partial<TextStyle>
): TextRun[] {
	const result: TextRun[] = [];
	let runStart = 0;
	for (const run of runs) {
		const runEnd = runStart + run.text.length;
		const insideStart = Math.max(from, runStart);
		const insideEnd = Math.min(to, runEnd);
		if (insideStart >= insideEnd) {
			result.push(run);
			runStart = runEnd;
			continue;
		}
		const before = run.text.slice(0, insideStart - runStart);
		const inside = run.text.slice(insideStart - runStart, insideEnd - runStart);
		const after = run.text.slice(insideEnd - runStart);
		if (before) result.push(makeRun(before, run.style));
		result.push(makeRun(inside, change(run.style)));
		if (after) result.push(makeRun(after, run.style));
		runStart = runEnd;
	}
	return result;
}

function sliceRuns(runs: TextRun[], from: number, to: number): TextRun[] {
	const result: TextRun[] = [];
	let runStart = 0;
	for (const run of runs) {
		const runEnd = runStart + run.text.length;
		const insideStart = Math.max(from, runStart);
		const insideEnd = Math.min(to, runEnd);
		if (insideStart < insideEnd) {
			result.push(makeRun(run.text.slice(insideStart - runStart, insideEnd - runStart), run.style));
		}
		runStart = runEnd;
	}
	return result;
}

function styleForInsertion(paragraph: Paragraph, offset: number): Partial<TextStyle> {
	if (paragraph.runs.length === 0) return {};
	let runStart = 0;
	for (const run of paragraph.runs) {
		const runEnd = runStart + run.text.length;
		if (offset <= runEnd) return run.style;
		runStart = runEnd;
	}
	return paragraph.runs[paragraph.runs.length - 1].style;
}

// ---------- editing operations ----------

function replaceParagraph(
	paragraphs: Paragraph[],
	index: number,
	replacement: Paragraph[]
): Paragraph[] {
	return [...paragraphs.slice(0, index), ...replacement, ...paragraphs.slice(index + 1)];
}

/**
 * Insert `text` at `position`. Line breaks in `text` start new paragraphs that copy the paragraph
 * properties of the one being edited. The new text takes `style` if given, else the style of the
 * run before the position (the first run when at the start of a paragraph).
 */
export function insertText(
	paragraphs: Paragraph[],
	position: TextPosition,
	text: string,
	style?: Partial<TextStyle>
): Paragraph[] {
	assertPosition(paragraphs, position);
	if (text === '') return normalizeParagraphs(paragraphs);
	const target = paragraphs[position.paragraph];
	const inserted = style === undefined ? styleForInsertion(target, position.offset) : style;
	const lines = text.split(/\r\n|\r|\n/);
	const length = paragraphLength(target);
	const head = sliceRuns(target.runs, 0, position.offset);
	const tail = sliceRuns(target.runs, position.offset, length);

	const pieces: Paragraph[] = lines.map((line, lineIndex) => {
		const runs: TextRun[] = [];
		if (lineIndex === 0) runs.push(...head);
		if (line) runs.push(makeRun(line, inserted));
		if (lineIndex === lines.length - 1) runs.push(...tail);
		return { ...emptyParagraph(target), runs };
	});
	return normalizeParagraphs(replaceParagraph(paragraphs, position.paragraph, pieces));
}

/** Delete the range. A range that spans a paragraph break joins the paragraphs it touches. */
export function deleteRange(paragraphs: Paragraph[], range: TextRange): Paragraph[] {
	const { start, end } = orderRange(range);
	assertPosition(paragraphs, start);
	assertPosition(paragraphs, end);
	const first = paragraphs[start.paragraph];
	const last = paragraphs[end.paragraph];
	const merged: Paragraph = {
		...emptyParagraph(first),
		runs: [
			...sliceRuns(first.runs, 0, start.offset),
			...sliceRuns(last.runs, end.offset, paragraphLength(last))
		]
	};
	const replacement = [
		...paragraphs.slice(0, start.paragraph),
		merged,
		...paragraphs.slice(end.paragraph + 1)
	];
	return normalizeParagraphs(replacement);
}

/** Break a paragraph in two at `position`; both halves keep the paragraph properties. */
export function splitParagraph(paragraphs: Paragraph[], position: TextPosition): Paragraph[] {
	assertPosition(paragraphs, position);
	const target = paragraphs[position.paragraph];
	const length = paragraphLength(target);
	const halves: Paragraph[] = [
		{ ...emptyParagraph(target), runs: sliceRuns(target.runs, 0, position.offset) },
		{ ...emptyParagraph(target), runs: sliceRuns(target.runs, position.offset, length) }
	];
	return normalizeParagraphs(replaceParagraph(paragraphs, position.paragraph, halves));
}

/** Join paragraph `index` with the one after it; the first keeps its properties. */
export function joinParagraphs(paragraphs: Paragraph[], index: number): Paragraph[] {
	const first = paragraphs[index];
	const second = paragraphs[index + 1];
	if (!first || !second) throw new RangeError(`no paragraph break after paragraph ${index}`);
	const joinedAt = { paragraph: index, offset: paragraphLength(first) };
	return deleteRange(paragraphs, { start: joinedAt, end: { paragraph: index + 1, offset: 0 } });
}

function mapStyleInRange(
	paragraphs: Paragraph[],
	range: TextRange,
	change: (style: Partial<TextStyle>) => Partial<TextStyle>
): Paragraph[] {
	const { start, end } = orderRange(range);
	assertPosition(paragraphs, start);
	assertPosition(paragraphs, end);
	const result = paragraphs.map((paragraph, index) => {
		if (index < start.paragraph || index > end.paragraph) return paragraph;
		const from = index === start.paragraph ? start.offset : 0;
		const to = index === end.paragraph ? end.offset : paragraphLength(paragraph);
		return { ...paragraph, runs: mapRunsInRange(paragraph.runs, from, to, change) };
	});
	return normalizeParagraphs(result);
}

/** Apply `style` over the range: runs are split at the edges, then merged back where equal. */
export function applyStyle(
	paragraphs: Paragraph[],
	range: TextRange,
	style: Partial<TextStyle>
): Paragraph[] {
	const patch = cleanStyle(style);
	return mapStyleInRange(paragraphs, range, (current) => ({ ...current, ...patch }));
}

/** Remove the listed style properties (all of them when `keys` is omitted) from the range. */
export function clearStyle(
	paragraphs: Paragraph[],
	range: TextRange,
	keys?: (keyof TextStyle)[]
): Paragraph[] {
	return mapStyleInRange(paragraphs, range, (current) => {
		if (keys === undefined) return {};
		const remaining: Partial<TextStyle> = { ...current };
		for (const key of keys) delete remaining[key];
		return remaining;
	});
}

/**
 * The style over a range: each property is its common value, or `MIXED` where the covered runs
 * differ. A collapsed range reads the style a caret there would type with. Values are effective
 * (defaultStyle plus delta). Text-less ranges read as the default style.
 */
export function readStyle(
	paragraphs: Paragraph[],
	range: TextRange,
	defaultStyle: TextStyle
): RangeStyle {
	const { start, end } = orderRange(range);
	assertPosition(paragraphs, start);
	assertPosition(paragraphs, end);
	const deltas = coveredStyles(paragraphs, start, end);
	if (deltas.length === 0) return structuredClone(defaultStyle);

	const resolved = deltas.map((delta) => resolveStyle(defaultStyle, delta));
	const keys = new Set(resolved.flatMap((style) => Object.keys(style)));
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const values = resolved.map((style) => (style as unknown as Record<string, unknown>)[key]);
		const same = values.every((value) => deepEqual(value, values[0]));
		if (!same) {
			result[key] = MIXED;
			continue;
		}
		if (values[0] !== undefined) result[key] = structuredClone(values[0]);
	}
	return result as RangeStyle;
}

function coveredStyles(
	paragraphs: Paragraph[],
	start: TextPosition,
	end: TextPosition
): Partial<TextStyle>[] {
	if (comparePositions(start, end) === 0) {
		const location = locateRun(paragraphs, start);
		if (location.run === null) return [];
		return [paragraphs[start.paragraph].runs[location.run].style];
	}
	const styles: Partial<TextStyle>[] = [];
	for (let index = start.paragraph; index <= end.paragraph; index += 1) {
		const paragraph = paragraphs[index];
		const from = index === start.paragraph ? start.offset : 0;
		const to = index === end.paragraph ? end.offset : paragraphLength(paragraph);
		for (const run of sliceRuns(paragraph.runs, from, to)) styles.push(run.style);
	}
	return styles;
}

// ---------- Skia ParagraphBuilder plan ----------

export type BuildStep =
	{ op: 'pushStyle'; style: TextStyle } | { op: 'addText'; text: string } | { op: 'pop' };

export interface ParagraphPlan {
	align: Paragraph['align'];
	indent: number;
	spacingAfter: number;
	list: Paragraph['list'];
	listLevel: number;
	/** Steps for one `ParagraphBuilder`, executed in order. */
	steps: BuildStep[];
}

/**
 * What the renderer feeds CanvasKit: per paragraph, one builder, and for each run
 * `pushStyle(resolved style)`, `addText(text)`, `pop()`. Pure data, so it is testable without
 * Skia. An empty paragraph still gets `pushStyle(default)`, `addText('')`, `pop()` so it keeps
 * a line height.
 */
export function buildPlan(paragraphs: Paragraph[], defaultStyle: TextStyle): ParagraphPlan[] {
	return paragraphs.map((paragraph) => {
		const steps: BuildStep[] = [];
		if (paragraph.runs.length === 0) {
			steps.push({ op: 'pushStyle', style: structuredClone(defaultStyle) });
			steps.push({ op: 'addText', text: '' });
			steps.push({ op: 'pop' });
		}
		for (const run of paragraph.runs) {
			steps.push({
				op: 'pushStyle',
				style: structuredClone(resolveStyle(defaultStyle, run.style))
			});
			steps.push({ op: 'addText', text: run.text });
			steps.push({ op: 'pop' });
		}
		return {
			align: paragraph.align,
			indent: paragraph.indent,
			spacingAfter: paragraph.spacingAfter,
			list: paragraph.list,
			listLevel: paragraph.listLevel,
			steps
		};
	});
}

// ---------- changes ----------

/** The `set paragraphs` change that turns `node` into `next`: one undoable transaction segment. */
export function paragraphsChange(node: TextNode, next: Paragraph[]): Change {
	return {
		t: 'set',
		id: node.id,
		set: { paragraphs: normalizeParagraphs(next) },
		prev: { paragraphs: node.paragraphs }
	};
}
