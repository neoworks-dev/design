// Pure helpers of the typography section: reading a possibly MIXED style value and the patches
// the section hands to `ctx.textFormat.applyPatch`.

import { MIXED, type FontName, type TextMeasure, type TextStyle } from '../../lib/document';
import type { StylePatch } from '../../lib/text/formatting';
import { isItalic, weightOf } from '../../lib/text/fontFace';

export interface ShownValue<Value> {
	value: Value | null;
	mixed: boolean;
}

/** Split a style value that may be MIXED or absent into what a control shows. */
export function shown<Value>(value: Value | typeof MIXED | undefined): ShownValue<Value> {
	if (value === MIXED) return { value: null, mixed: true };
	if (value === undefined) return { value: null, mixed: false };
	return { value, mixed: false };
}

/** The style of a family nearest to `style`: same slant first, then closest weight. */
export function styleForFamily(styles: readonly string[], style: string): string {
	if (styles.includes(style)) return style;
	if (styles.length === 0) return style;
	const wanted = weightOf(style);
	const wantedItalic = isItalic(style);
	const distance = (candidate: string): number => {
		const slant = isItalic(candidate) === wantedItalic ? 0 : 1000;
		return slant + Math.abs(weightOf(candidate) - wanted);
	};
	return styles.reduce((best, candidate) =>
		distance(candidate) < distance(best) ? candidate : best
	);
}

export function fontFamilyPatch(family: string, styles: readonly string[]): StylePatch {
	return (effective) => {
		const style = styleForFamily(styles, effective.fontName.style);
		return { fontName: { family, style }, fontWeight: weightOf(style) };
	};
}

export function fontStylePatch(style: string): StylePatch {
	return (effective) => ({
		fontName: { family: effective.fontName.family, style },
		fontWeight: weightOf(style)
	});
}

export function fontSizeValuePatch(size: number): StylePatch {
	return () => ({ fontSize: size });
}

/** `null` is automatic line height. */
export function lineHeightValuePatch(measure: TextMeasure | null): StylePatch {
	if (measure === null) return () => ({ lineHeight: { unit: 'AUTO' } });
	return () => ({ lineHeight: measure });
}

export function letterSpacingValuePatch(measure: TextMeasure): StylePatch {
	return () => ({ letterSpacing: measure });
}

export function textCasePatch(textCase: TextStyle['textCase']): StylePatch {
	return () => ({ textCase });
}

export function decorationValuePatch(decoration: TextStyle['textDecoration']): StylePatch {
	return () => ({ textDecoration: decoration });
}

export function openTypeFeaturePatch(tag: string, enabled: boolean): StylePatch {
	return (effective) => ({ openTypeFeatures: { ...effective.openTypeFeatures, [tag]: enabled } });
}

/** Styles available for a family, in weight order. */
export function stylesOfFamily(faces: readonly FontName[], family: string): string[] {
	const names = new Set<string>();
	for (const face of faces) {
		if (face.family.toLowerCase() === family.toLowerCase()) names.add(face.style);
	}
	return [...names].sort((left, right) => weightOf(left) - weightOf(right));
}

/** Families whose name contains `query`, case-insensitive. */
export function filterFamilies(families: readonly string[], query: string): string[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') return [...families];
	return families.filter((family) => family.toLowerCase().includes(needle));
}

export const OPEN_TYPE_FEATURES: { tag: string; label: string; defaultOn: boolean }[] = [
	{ tag: 'liga', label: 'Ligatures', defaultOn: true },
	{ tag: 'kern', label: 'Kerning', defaultOn: true },
	{ tag: 'tnum', label: 'Tabular numbers', defaultOn: false },
	{ tag: 'smcp', label: 'Small caps', defaultOn: false }
];
