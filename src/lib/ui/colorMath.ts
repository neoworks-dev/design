// Colour space maths for the picker. Colours are 0..1 floats everywhere; hue is 0..360. Pure.

import type { RGB, RGBA } from '../document/types';

export interface Hsv {
	h: number;
	s: number;
	v: number;
}
export interface Hsl {
	h: number;
	s: number;
	l: number;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function rgbToHsv(color: RGB): Hsv {
	const { r, g, b } = color;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	let hue = 0;
	if (delta > 0) {
		if (max === r) hue = ((g - b) / delta) % 6;
		else if (max === g) hue = (b - r) / delta + 2;
		else hue = (r - g) / delta + 4;
		hue *= 60;
		if (hue < 0) hue += 360;
	}
	let saturation = 0;
	if (max > 0) saturation = delta / max;
	return { h: hue, s: saturation, v: max };
}

export function hsvToRgb(hsv: Hsv): RGB {
	const chroma = hsv.v * hsv.s;
	const sector = (((hsv.h % 360) + 360) % 360) / 60;
	const second = chroma * (1 - Math.abs((sector % 2) - 1));
	const offset = hsv.v - chroma;
	const table: Array<[number, number, number]> = [
		[chroma, second, 0],
		[second, chroma, 0],
		[0, chroma, second],
		[0, second, chroma],
		[second, 0, chroma],
		[chroma, 0, second]
	];
	const [r, g, b] = table[Math.min(5, Math.floor(sector))];
	return { r: r + offset, g: g + offset, b: b + offset };
}

export function rgbToHsl(color: RGB): Hsl {
	const hsv = rgbToHsv(color);
	const lightness = hsv.v * (1 - hsv.s / 2);
	let saturation = 0;
	if (lightness > 0 && lightness < 1) {
		saturation = (hsv.v - lightness) / Math.min(lightness, 1 - lightness);
	}
	return { h: hsv.h, s: saturation, l: lightness };
}

export function hslToRgb(hsl: Hsl): RGB {
	const value = hsl.l + hsl.s * Math.min(hsl.l, 1 - hsl.l);
	let saturation = 0;
	if (value > 0) saturation = 2 * (1 - hsl.l / value);
	return hsvToRgb({ h: hsl.h, s: saturation, v: value });
}

function channelToHex(channel: number): string {
	return Math.round(clamp01(channel) * 255)
		.toString(16)
		.padStart(2, '0');
}

export function rgbToHex(color: RGB): string {
	return `${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`.toUpperCase();
}

/** Parse `rgb`, `#rgb`, `rrggbb` or `rrggbbaa`; undefined when the text is not a colour. */
export function parseHex(text: string): RGBA | undefined {
	let digits = text.trim().replace('#', '');
	if (digits.length === 3)
		digits = digits
			.split('')
			.map((digit) => digit + digit)
			.join('');
	if (digits.length !== 6 && digits.length !== 8) return undefined;
	if (!/^[0-9a-fA-F]+$/.test(digits)) return undefined;
	const byte = (start: number): number => Number.parseInt(digits.slice(start, start + 2), 16) / 255;
	let alpha = 1;
	if (digits.length === 8) alpha = byte(6);
	return { r: byte(0), g: byte(2), b: byte(4), a: alpha };
}

/** CSS `rgba()` text for previews. */
export function rgbaCss(color: RGB, alpha: number): string {
	const byte = (channel: number): number => Math.round(clamp01(channel) * 255);
	return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${alpha})`;
}

/** Lighten (positive) or darken (negative) by `amount` of lightness, keeping hue and alpha. */
export function shiftLightness(color: RGBA, amount: number): RGBA {
	const hsl = rgbToHsl(color);
	const shifted = hslToRgb({ ...hsl, l: clamp01(hsl.l + amount) });
	return { ...shifted, a: color.a };
}
