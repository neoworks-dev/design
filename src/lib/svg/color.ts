// SVG colour values to RGBA (#106). Hex, rgb()/rgba(), hsl()/hsla() and the common named colours.

import type { RGBA } from '../document/types';

const NAMED: Record<string, string> = {
	aliceblue: 'f0f8ff',
	aqua: '00ffff',
	beige: 'f5f5dc',
	black: '000000',
	blue: '0000ff',
	brown: 'a52a2a',
	coral: 'ff7f50',
	crimson: 'dc143c',
	cyan: '00ffff',
	darkblue: '00008b',
	darkgray: 'a9a9a9',
	darkgreen: '006400',
	darkgrey: 'a9a9a9',
	darkorange: 'ff8c00',
	darkred: '8b0000',
	deeppink: 'ff1493',
	fuchsia: 'ff00ff',
	gold: 'ffd700',
	gray: '808080',
	green: '008000',
	grey: '808080',
	hotpink: 'ff69b4',
	indigo: '4b0082',
	ivory: 'fffff0',
	khaki: 'f0e68c',
	lavender: 'e6e6fa',
	lightblue: 'add8e6',
	lightgray: 'd3d3d3',
	lightgreen: '90ee90',
	lightgrey: 'd3d3d3',
	lightyellow: 'ffffe0',
	lime: '00ff00',
	magenta: 'ff00ff',
	maroon: '800000',
	navy: '000080',
	olive: '808000',
	orange: 'ffa500',
	orchid: 'da70d6',
	pink: 'ffc0cb',
	purple: '800080',
	red: 'ff0000',
	salmon: 'fa8072',
	silver: 'c0c0c0',
	skyblue: '87ceeb',
	tan: 'd2b48c',
	teal: '008080',
	tomato: 'ff6347',
	turquoise: '40e0d0',
	violet: 'ee82ee',
	white: 'ffffff',
	whitesmoke: 'f5f5f5',
	yellow: 'ffff00'
};

function channel(value: string): number | null {
	const trimmed = value.trim();
	const number = Number.parseFloat(trimmed);
	if (!Number.isFinite(number)) return null;
	if (trimmed.endsWith('%')) return Math.min(1, Math.max(0, number / 100));
	return Math.min(1, Math.max(0, number / 255));
}

function alphaOf(value: string | undefined): number | null {
	if (value === undefined) return 1;
	const trimmed = value.trim();
	const number = Number.parseFloat(trimmed);
	if (!Number.isFinite(number)) return null;
	if (trimmed.endsWith('%')) return Math.min(1, Math.max(0, number / 100));
	return Math.min(1, Math.max(0, number));
}

function fromHex(hex: string): RGBA | null {
	let digits = hex;
	if (digits.length === 3 || digits.length === 4) {
		digits = digits
			.split('')
			.map((digit) => digit + digit)
			.join('');
	}
	if (digits.length !== 6 && digits.length !== 8) return null;
	if (!/^[0-9a-f]+$/i.test(digits)) return null;
	const part = (offset: number): number =>
		Number.parseInt(digits.slice(offset, offset + 2), 16) / 255;
	return { r: part(0), g: part(2), b: part(4), a: digits.length === 8 ? part(6) : 1 };
}

function hueToChannel(p: number, q: number, hue: number): number {
	let t = hue;
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

function fromHsl(parts: string[]): RGBA | null {
	if (parts.length < 3) return null;
	const hue = (((Number.parseFloat(parts[0]) % 360) + 360) % 360) / 360;
	const saturation = Number.parseFloat(parts[1]) / 100;
	const lightness = Number.parseFloat(parts[2]) / 100;
	const alpha = alphaOf(parts[3]);
	if ([hue, saturation, lightness].some((value) => !Number.isFinite(value)) || alpha === null) {
		return null;
	}
	if (saturation === 0) return { r: lightness, g: lightness, b: lightness, a: alpha };
	const q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	return {
		r: hueToChannel(p, q, hue + 1 / 3),
		g: hueToChannel(p, q, hue),
		b: hueToChannel(p, q, hue - 1 / 3),
		a: alpha
	};
}

function functionArguments(value: string): string[] {
	const inside = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
	return inside.split(/[\s,/]+/).filter((part) => part !== '');
}

/** The colour `value` names, or null when it is not a colour this importer understands. */
export function parseColor(value: string): RGBA | null {
	const text = value.trim().toLowerCase();
	if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
	if (text.startsWith('#')) return fromHex(text.slice(1));
	if (text.startsWith('rgb')) {
		const parts = functionArguments(text);
		if (parts.length < 3) return null;
		const [red, green, blue] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
		const alpha = alphaOf(parts[3]);
		if (red === null || green === null || blue === null || alpha === null) return null;
		return { r: red, g: green, b: blue, a: alpha };
	}
	if (text.startsWith('hsl')) return fromHsl(functionArguments(text));
	const named = NAMED[text];
	if (named === undefined) return null;
	return fromHex(named);
}
