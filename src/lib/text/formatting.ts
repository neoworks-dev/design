// Formatting as pure functions over paragraphs of runs: bold, italic, underline, strikethrough,
// font size, line height, letter spacing, weight, alignment, lists and links. Each function takes
// the paragraphs (and, for run styles, the node's default style) and returns new, normalized
// paragraphs; nothing here knows about the editor, the document or the keymap.
//
// A run style is a delta over the node default. A style change is therefore computed per run from
// the run's *effective* style (so "size + 1" works on runs of different sizes) and written back as
// a delta over the (possibly changed) default, so runs that end up identical merge again.

import {
	MIXED,
	deepEqual,
	mapStyleInRange,
	normalizeParagraphs,
	readStyle,
	resolveStyle,
	type RangeStyle,
	type TextRange
} from '../document/text';
import type { Hyperlink, Paragraph, TextRun, TextStyle } from '../document/types';
import { isItalic, weightOf, withItalic, withWeight } from './fontFace';

/** What to change about a run, given its effective style. */
export type StylePatch = (effective: TextStyle) => Partial<TextStyle>;

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 1000;
export const MAX_LIST_LEVEL = 8;
const BOLD_WEIGHT = 700;
const REGULAR_WEIGHT = 400;
const BOLD_THRESHOLD = 600;
const AUTO_LINE_HEIGHT_FACTOR = 1.2;

// ---------- applying a patch ----------

function patchedDelta(
	delta: Partial<TextStyle>,
	oldDefault: TextStyle,
	newDefault: TextStyle,
	patch: StylePatch
): Partial<TextStyle> {
	const effective = resolveStyle(oldDefault, delta);
	const changed: TextStyle = { ...effective, ...patch(effective) };
	const result: Record<string, unknown> = {};
	const base = newDefault as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(changed)) {
		if (value === undefined || deepEqual(base[key], value)) continue;
		result[key] = structuredClone(value);
	}
	return result as Partial<TextStyle>;
}

/**
 * Apply `patch` to every run in `range`. The default style is untouched: the result for a range
 * in the middle of a node. Runs are split at the range edges and merged back where equal.
 */
export function restyleRange(
	paragraphs: Paragraph[],
	defaultStyle: TextStyle,
	range: TextRange,
	patch: StylePatch
): Paragraph[] {
	return mapStyleInRange(paragraphs, range, (delta) =>
		patchedDelta(delta, defaultStyle, defaultStyle, patch)
	);
}

export interface RestyledNode {
	paragraphs: Paragraph[];
	defaultStyle: TextStyle;
}

/**
 * Apply `patch` to the whole node: the default style changes, and so does every run (a run that
 * set the property itself gets the patch on top of its own value).
 */
export function restyleNode(
	paragraphs: Paragraph[],
	defaultStyle: TextStyle,
	patch: StylePatch
): RestyledNode {
	const newDefault: TextStyle = { ...defaultStyle, ...patch(defaultStyle) };
	const restyled = paragraphs.map((paragraph) => ({
		...paragraph,
		runs: paragraph.runs.map((run): TextRun => ({
			text: run.text,
			style: patchedDelta(run.style, defaultStyle, newDefault, patch)
		}))
	}));
	return { paragraphs: normalizeParagraphs(restyled), defaultStyle: newDefault };
}

/** The style delta a caret should type with after `patch`, without what the default says anyway. */
export function patchedTypingStyle(
	current: Partial<TextStyle>,
	defaultStyle: TextStyle,
	patch: StylePatch
): Partial<TextStyle> {
	return patchedDelta(current, defaultStyle, defaultStyle, patch);
}

// ---------- the patches ----------

export function boldPatch(enable: boolean): StylePatch {
	const weight = enable ? BOLD_WEIGHT : REGULAR_WEIGHT;
	return (style) => ({
		fontWeight: weight,
		fontName: { family: style.fontName.family, style: withWeight(style.fontName.style, weight) }
	});
}

export function italicPatch(enable: boolean): StylePatch {
	return (style) => ({
		fontName: { family: style.fontName.family, style: withItalic(style.fontName.style, enable) }
	});
}

export function decorationPatch(decoration: TextStyle['textDecoration']): StylePatch {
	return () => ({ textDecoration: decoration });
}

export function fontSizePatch(delta: number): StylePatch {
	return (style) => ({
		fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, style.fontSize + delta))
	});
}

/** Weight steps through 100 .. 900 and picks the matching style name of the family. */
export function weightPatch(delta: number): StylePatch {
	return (style) => {
		const current = weightOf(style.fontName.style);
		const weight = Math.min(900, Math.max(100, current + delta));
		return {
			fontWeight: weight,
			fontName: { family: style.fontName.family, style: withWeight(style.fontName.style, weight) }
		};
	};
}

/** Automatic line height becomes pixels first (1.2 times the size), then steps by 1 px or 5 %. */
export function lineHeightPatch(delta: number): StylePatch {
	return (style) => {
		const height = style.lineHeight;
		if (height.unit === 'AUTO') {
			const pixels = Math.round(style.fontSize * AUTO_LINE_HEIGHT_FACTOR) + delta;
			return { lineHeight: { value: Math.max(1, pixels), unit: 'PIXELS' } };
		}
		const step = height.unit === 'PERCENT' ? delta * 5 : delta;
		return { lineHeight: { value: Math.max(1, height.value + step), unit: height.unit } };
	};
}

export function letterSpacingPatch(delta: number): StylePatch {
	return (style) => ({
		letterSpacing: {
			value: Math.round((style.letterSpacing.value + delta) * 100) / 100,
			unit: style.letterSpacing.unit
		}
	});
}

/** Set a link, or remove it with `null` (`undefined` drops the property from every delta). */
export function hyperlinkPatch(link: Hyperlink | null): StylePatch {
	if (link === null) return () => ({ hyperlink: undefined });
	return () => ({ hyperlink: link });
}

// ---------- reading what is there ----------

/** True when the whole range is bold, so the shortcut turns bold off instead of on. */
export function isBold(style: RangeStyle): boolean {
	const weight = style.fontWeight;
	if (weight === MIXED || weight === undefined) return false;
	return weight >= BOLD_THRESHOLD;
}

export function isItalicStyle(style: RangeStyle): boolean {
	const font = style.fontName;
	if (font === MIXED || font === undefined) return false;
	return isItalic(font.style);
}

export function hasDecoration(style: RangeStyle, decoration: TextStyle['textDecoration']): boolean {
	return style.textDecoration === decoration;
}

export function styleOfRange(
	paragraphs: Paragraph[],
	defaultStyle: TextStyle,
	range: TextRange
): RangeStyle {
	return readStyle(paragraphs, range, defaultStyle);
}

/**
 * Merge the styles of several texts (several selected nodes): equal values stay, differing ones
 * become MIXED.
 */
export function mergeRangeStyles(styles: RangeStyle[]): RangeStyle {
	if (styles.length === 0) return {};
	const merged: Record<string, unknown> = {};
	const keys = new Set(styles.flatMap((style) => Object.keys(style)));
	for (const key of keys) {
		const values = styles.map((style) => (style as Record<string, unknown>)[key]);
		const same = values.every((value) => deepEqual(value, values[0]));
		merged[key] = same ? values[0] : MIXED;
	}
	return merged as RangeStyle;
}

// ---------- paragraph properties ----------

/** Apply `change` to each paragraph touched by `range` (all paragraphs when `range` is null). */
export function updateParagraphs(
	paragraphs: Paragraph[],
	range: TextRange | null,
	change: (paragraph: Paragraph) => Paragraph
): Paragraph[] {
	const first = range === null ? 0 : range.start.paragraph;
	const last = range === null ? paragraphs.length - 1 : range.end.paragraph;
	return paragraphs.map((paragraph, index) => {
		if (index < first || index > last) return paragraph;
		return change(paragraph);
	});
}

export function paragraphsIn(paragraphs: Paragraph[], range: TextRange | null): Paragraph[] {
	const first = range === null ? 0 : range.start.paragraph;
	const last = range === null ? paragraphs.length - 1 : range.end.paragraph;
	return paragraphs.slice(first, last + 1);
}

export function setAlignment(
	paragraphs: Paragraph[],
	range: TextRange | null,
	align: Paragraph['align']
): Paragraph[] {
	return updateParagraphs(paragraphs, range, (paragraph) => ({ ...paragraph, align }));
}

/** Turn the list on for the paragraphs, or off when they all have that kind of list already. */
export function toggleList(
	paragraphs: Paragraph[],
	range: TextRange | null,
	kind: 'ORDERED' | 'UNORDERED'
): Paragraph[] {
	const affected = paragraphsIn(paragraphs, range);
	const allHave = affected.every((paragraph) => paragraph.list === kind);
	return updateParagraphs(paragraphs, range, (paragraph) => {
		if (allHave) return { ...paragraph, list: 'NONE', listLevel: 0 };
		return { ...paragraph, list: kind };
	});
}

/**
 * Tab (+1) and Shift+Tab (-1) on list items. Outdenting a first-level item takes it out of the
 * list. Paragraphs that are not list items are left alone.
 */
export function changeListLevel(
	paragraphs: Paragraph[],
	range: TextRange | null,
	delta: 1 | -1
): Paragraph[] {
	return updateParagraphs(paragraphs, range, (paragraph) => {
		if (paragraph.list === 'NONE') return paragraph;
		const level = paragraph.listLevel + delta;
		if (level < 0) return { ...paragraph, list: 'NONE', listLevel: 0 };
		return { ...paragraph, listLevel: Math.min(level, MAX_LIST_LEVEL) };
	});
}

export function hasListItems(paragraphs: Paragraph[], range: TextRange | null): boolean {
	return paragraphsIn(paragraphs, range).some((paragraph) => paragraph.list !== 'NONE');
}
