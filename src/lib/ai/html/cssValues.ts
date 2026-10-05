// Parsers for computed CSS values that come back as strings: shadows, gradients, lengths and
// `var()` references. Colours inside them are handed to `ColorParser`, which the measuring step
// backs with a canvas so any colour syntax the browser understands works. Pure: no DOM.

import type { RGBA } from '../../document';
import type {
	BackgroundLayer,
	ColorStopSnapshot,
	GradientDirection,
	ShadowSnapshot
} from './snapshot';

export type ColorParser = (value: string) => RGBA | null;

/** Splits on `separator` outside of parentheses and quotes; empty parts are dropped. */
export function splitTopLevel(value: string, separator: ',' | ' '): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let current = '';
	for (const character of value) {
		if (quote !== null) {
			if (character === quote) quote = null;
			current += character;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		const splits =
			depth === 0 && (character === separator || (separator === ' ' && /\s/.test(character)));
		if (splits) {
			if (current.trim() !== '') parts.push(current.trim());
			current = '';
			continue;
		}
		current += character;
	}
	if (current.trim() !== '') parts.push(current.trim());
	return parts;
}

/** `12px` -> 12; anything that is not a pixel length (or a bare 0) -> null. */
export function pixels(value: string): number | null {
	const match = /^(-?[\d.]+(?:e-?\d+)?)(px)?$/.exec(value.trim());
	if (match === null) return null;
	if (match[2] === undefined && Number(match[1]) !== 0) return null;
	return Number(match[1]);
}

/** Pixels, or 0 for `normal`, `auto` and anything unparseable. */
export function pixelsOrZero(value: string): number {
	const parsed = pixels(value);
	if (parsed === null) return 0;
	return parsed;
}

/** `var(--name)` or `var(--name, fallback)` as the whole value -> `--name`. */
export function variableReference(value: string): string | null {
	const match = /^var\(\s*(--[\w-]+)\s*(?:,.*)?\)$/s.exec(value.trim());
	if (match === null) return null;
	return match[1];
}

// ---------- shadows ----------

export function parseShadows(value: string, parseColor: ColorParser): ShadowSnapshot[] {
	if (value.trim() === 'none') return [];
	const shadows: ShadowSnapshot[] = [];
	for (const part of splitTopLevel(value, ',')) {
		const shadow = parseShadow(part, parseColor);
		if (shadow !== null) shadows.push(shadow);
	}
	return shadows;
}

function parseShadow(value: string, parseColor: ColorParser): ShadowSnapshot | null {
	const lengths: number[] = [];
	const colorTokens: string[] = [];
	let inset = false;
	for (const token of splitTopLevel(value, ' ')) {
		if (token === 'inset') {
			inset = true;
			continue;
		}
		const length = pixels(token);
		if (length !== null) lengths.push(length);
		else colorTokens.push(token);
	}
	if (lengths.length < 2) return null;
	let color: RGBA | null = { r: 0, g: 0, b: 0, a: 1 };
	if (colorTokens.length > 0) color = parseColor(colorTokens.join(' '));
	if (color === null || color.a === 0) return null;
	return {
		inset,
		color,
		x: lengths[0],
		y: lengths[1],
		blur: lengths[2] ?? 0,
		spread: lengths[3] ?? 0
	};
}

// ---------- filters ----------

/** The radius of the first `blur()` in a `filter` / `backdrop-filter` value, else 0. */
export function blurRadius(value: string): number {
	const match = /blur\(\s*([\d.]+)px\s*\)/.exec(value);
	if (match === null) return 0;
	return Number(match[1]);
}

// ---------- backgrounds ----------

export interface BackgroundParse {
	layers: BackgroundLayer[];
	warnings: string[];
}

export function parseBackgroundImage(value: string, parseColor: ColorParser): BackgroundParse {
	const result: BackgroundParse = { layers: [], warnings: [] };
	if (value.trim() === 'none') return result;
	for (const layer of splitTopLevel(value, ',')) {
		const parsed = parseLayer(layer, parseColor);
		if (typeof parsed === 'string') result.warnings.push(parsed);
		else result.layers.push(parsed);
	}
	return result;
}

function functionArguments(value: string, name: string): string[] | null {
	const prefix = `${name}(`;
	if (!value.startsWith(prefix) || !value.endsWith(')')) return null;
	return splitTopLevel(value.slice(prefix.length, -1), ',');
}

function parseLayer(value: string, parseColor: ColorParser): BackgroundLayer | string {
	const url = /^url\(\s*["']?(.*?)["']?\s*\)$/.exec(value);
	if (url !== null) return { kind: 'image', url: url[1] };
	const linear = functionArguments(value, 'linear-gradient');
	if (linear !== null) return parseLinear(linear, parseColor);
	const radial = functionArguments(value, 'radial-gradient');
	if (radial !== null) return parseRadial(radial, parseColor);
	return `background ${value.slice(0, 40)} is not supported`;
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

function angleDegrees(value: string): number | null {
	const match = /^(-?[\d.]+)(deg|rad|turn|grad)$/.exec(value);
	if (match === null) return null;
	const amount = Number(match[1]);
	if (match[2] === 'rad') return (amount * 180) / Math.PI;
	if (match[2] === 'turn') return amount * 360;
	if (match[2] === 'grad') return amount * 0.9;
	return amount;
}

function directionOf(value: string): GradientDirection | null {
	const degrees = angleDegrees(value);
	if (degrees !== null) return { kind: 'angle', degrees };
	if (!value.startsWith('to ')) return null;
	const words = value.slice(3).trim().split(/\s+/);
	if (words.length === 1) {
		const side = SIDE_ANGLES[words[0]];
		if (side === undefined) return null;
		return { kind: 'angle', degrees: side };
	}
	let x: -1 | 1 = 1;
	let y: -1 | 1 = 1;
	for (const word of words) {
		if (word === 'left') x = -1;
		if (word === 'top') y = -1;
	}
	return { kind: 'corner', x, y };
}

function parseLinear(parts: string[], parseColor: ColorParser): BackgroundLayer | string {
	let direction: GradientDirection = { kind: 'angle', degrees: 180 };
	let stopParts = parts;
	const first = directionOf(parts[0]);
	if (first !== null) {
		direction = first;
		stopParts = parts.slice(1);
	}
	const stops = parseStops(stopParts, parseColor);
	if (stops.length < 2) return 'linear-gradient with fewer than two colour stops';
	return { kind: 'linear', direction, stops };
}

function parseRadial(parts: string[], parseColor: ColorParser): BackgroundLayer | string {
	let stopParts = parts;
	if (parseStop(parts[0], parseColor).length === 0) stopParts = parts.slice(1);
	const stops = parseStops(stopParts, parseColor);
	if (stops.length < 2) return 'radial-gradient with fewer than two colour stops';
	return { kind: 'radial', stops };
}

function parseStops(parts: string[], parseColor: ColorParser): ColorStopSnapshot[] {
	return parts.flatMap((part) => parseStop(part, parseColor));
}

function stopPosition(token: string): ColorStopSnapshot['position'] | undefined {
	const percent = /^(-?[\d.]+)%$/.exec(token);
	if (percent !== null) return { value: Number(percent[1]), unit: '%' };
	const length = pixels(token);
	if (length !== null) return { value: length, unit: 'px' };
	return undefined;
}

/** A stop with two positions (`red 10% 20%`) is two stops of the same colour. */
function parseStop(value: string, parseColor: ColorParser): ColorStopSnapshot[] {
	const tokens = splitTopLevel(value, ' ');
	const positions: NonNullable<ColorStopSnapshot['position']>[] = [];
	while (tokens.length > 1) {
		const position = stopPosition(tokens[tokens.length - 1]);
		if (position === undefined || position === null) break;
		positions.unshift(position);
		tokens.pop();
	}
	const color = parseColor(tokens.join(' '));
	if (color === null) return [];
	if (positions.length === 0) return [{ color, position: null }];
	return positions.map((position) => ({ color, position }));
}

// ---------- plain rgb() ----------

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` / `transparent`; anything else is null. */
export function parseRgbFunction(value: string): RGBA | null {
	const trimmed = value.trim();
	if (trimmed === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
	const match =
		/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(trimmed);
	if (match === null) return null;
	let alpha = 1;
	if (match[4] !== undefined) {
		alpha = match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
	}
	return {
		r: Number(match[1]) / 255,
		g: Number(match[2]) / 255,
		b: Number(match[3]) / 255,
		a: alpha
	};
}
