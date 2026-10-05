// Conversions between 0..1 RGB (the document's colour) and `#rrggbb` (what colour inputs speak).

export interface SwatchColor {
	r: number;
	g: number;
	b: number;
}

function channelToHex(channel: number): string {
	const byte = Math.round(Math.min(1, Math.max(0, channel)) * 255);
	return byte.toString(16).padStart(2, '0');
}

export function colorToHex(color: SwatchColor): string {
	return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
}

export function hexToColor(hex: string): SwatchColor {
	const digits = hex.replace('#', '');
	return {
		r: Number.parseInt(digits.slice(0, 2), 16) / 255,
		g: Number.parseInt(digits.slice(2, 4), 16) / 255,
		b: Number.parseInt(digits.slice(4, 6), 16) / 255
	};
}
