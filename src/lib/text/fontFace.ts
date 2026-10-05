// How document fonts reach Skia: every face the fonts service loads is registered in a
// TypefaceFontProvider under one unique family name (`faceKey`), so a run selects its exact face
// by name and Skia never has to match weights itself. The name crosses embind as a C string, so
// it must not contain a NUL.

import type { FontRef } from '../fonts/resolve';
import { parseStyle } from '../fonts/style';

export function faceKey(face: FontRef): string {
	return `${face.family}::${face.style}`.toLowerCase();
}

const WEIGHT_NAMES: [number, string][] = [
	[100, 'Thin'],
	[200, 'ExtraLight'],
	[300, 'Light'],
	[400, 'Regular'],
	[500, 'Medium'],
	[600, 'SemiBold'],
	[700, 'Bold'],
	[800, 'ExtraBold'],
	[900, 'Black']
];

/** The style name for a weight and slant: 700 + italic gives "Bold Italic", 400 + italic "Italic". */
export function styleName(weight: number, italic: boolean): string {
	const nearest = WEIGHT_NAMES.reduce((best, entry) =>
		Math.abs(entry[0] - weight) < Math.abs(best[0] - weight) ? entry : best
	);
	if (!italic) return nearest[1];
	if (nearest[0] === 400) return 'Italic';
	return `${nearest[1]} Italic`;
}

/** The same style name with another weight, keeping the slant. */
export function withWeight(style: string, weight: number): string {
	return styleName(weight, parseStyle(style).italic);
}

/** The same style name with the slant switched, keeping the weight. */
export function withItalic(style: string, italic: boolean): string {
	return styleName(parseStyle(style).weight, italic);
}

export function weightOf(style: string): number {
	return parseStyle(style).weight;
}

export function isItalic(style: string): boolean {
	return parseStyle(style).italic;
}
