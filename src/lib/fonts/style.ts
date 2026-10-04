// Parsing of font style names ("Bold Italic", "SemiBold", "Light Oblique") into weight and slant,
// so a style that is not installed can be matched to the nearest one that is.

export interface StyleTraits {
	weight: number;
	italic: boolean;
}

// Longer names first, so "semibold" is not read as "bold".
const WEIGHTS: [string, number][] = [
	['extralight', 200],
	['ultralight', 200],
	['semibold', 600],
	['demibold', 600],
	['extrabold', 800],
	['ultrabold', 800],
	['thin', 100],
	['hairline', 100],
	['light', 300],
	['regular', 400],
	['normal', 400],
	['book', 400],
	['medium', 500],
	['bold', 700],
	['black', 900],
	['heavy', 900]
];

export function parseStyle(style: string): StyleTraits {
	const text = style.toLowerCase().replace(/[\s_-]+/g, '');
	const italic = text.includes('italic') || text.includes('oblique');
	for (const [name, weight] of WEIGHTS) {
		if (text.includes(name)) return { weight, italic };
	}
	return { weight: 400, italic };
}

/** Distance between two styles; 0 for the same traits. Slant outweighs any weight difference. */
export function styleDistance(left: string, right: string): number {
	const a = parseStyle(left);
	const b = parseStyle(right);
	return (a.italic === b.italic ? 0 : 1000) + Math.abs(a.weight - b.weight);
}
