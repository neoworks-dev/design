// Hex colors as the model writes them, and the 0..1 channels documents store.

import type { RGB } from '../../document';

const HEX_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function hexToRgb(hex: string): RGB {
	const match = HEX_PATTERN.exec(hex.trim());
	if (!match) throw new Error(`"${hex}" is not a hex color like #ff8800`);
	let digits = match[1];
	if (digits.length === 3)
		digits = digits
			.split('')
			.map((digit) => digit + digit)
			.join('');
	return {
		r: parseInt(digits.slice(0, 2), 16) / 255,
		g: parseInt(digits.slice(2, 4), 16) / 255,
		b: parseInt(digits.slice(4, 6), 16) / 255
	};
}

function channel(value: number): string {
	const byte = Math.round(Math.max(0, Math.min(1, value)) * 255);
	return byte.toString(16).padStart(2, '0');
}

export function rgbToHex(color: RGB): string {
	return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}
