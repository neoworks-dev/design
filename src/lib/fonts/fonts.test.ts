import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readFontName } from '../../../electron/fonts/sfnt';
import { resolveFont, type FontEntry } from './resolve';
import { parseStyle, styleDistance } from './style';
import { woffToSfnt } from './woff';

function face(family: string, style: string, source: FontEntry['source'] = 'system'): FontEntry {
	return { family, style, source };
}

const GEIST: FontEntry[] = [
	face('Geist', 'Regular', 'bundled'),
	face('Geist', 'Medium', 'bundled'),
	face('Geist', 'SemiBold', 'bundled'),
	face('Geist', 'Bold', 'bundled')
];

describe('parseStyle', () => {
	it('reads weight and slant from style names', () => {
		expect(parseStyle('Regular')).toEqual({ weight: 400, italic: false });
		expect(parseStyle('Bold Italic')).toEqual({ weight: 700, italic: true });
		expect(parseStyle('Semi-Bold')).toEqual({ weight: 600, italic: false });
		expect(parseStyle('ExtraLight Oblique')).toEqual({ weight: 200, italic: true });
		expect(parseStyle('Italic')).toEqual({ weight: 400, italic: true });
		expect(parseStyle('Whatever')).toEqual({ weight: 400, italic: false });
	});

	it('ranks a slant mismatch worse than any weight difference', () => {
		expect(styleDistance('Bold', 'Bold')).toBe(0);
		expect(styleDistance('Bold', 'Italic')).toBeGreaterThan(styleDistance('Thin', 'Black'));
	});
});

describe('resolveFont', () => {
	const installed = [
		face('Inter', 'Regular'),
		face('Inter', 'Bold'),
		face('Inter', 'Italic'),
		face('Lora', 'Regular')
	];
	const faces = [...installed, ...GEIST];

	it('finds the exact face and does not flag it', () => {
		expect(resolveFont({ family: 'Inter', style: 'Bold' }, faces, GEIST)).toEqual({
			face: face('Inter', 'Bold'),
			missing: false
		});
	});

	it('matches names case-insensitively', () => {
		const resolved = resolveFont({ family: 'inter', style: 'bold' }, faces, GEIST);
		expect(resolved).toEqual({ face: face('Inter', 'Bold'), missing: false });
	});

	it('a bundled face counts as available, not missing', () => {
		expect(resolveFont({ family: 'Geist', style: 'Medium' }, faces, GEIST).missing).toBe(false);
	});

	it('prefers embedded over system over bundled for the same name', () => {
		const all = [
			face('Geist', 'Regular', 'bundled'),
			face('Geist', 'Regular', 'system'),
			face('Geist', 'Regular', 'embedded')
		];
		expect(resolveFont({ family: 'Geist', style: 'Regular' }, all, GEIST).face.source).toBe(
			'embedded'
		);
	});

	it('uses the nearest style of the same family when the style is missing', () => {
		expect(resolveFont({ family: 'Inter', style: 'Black' }, faces, GEIST)).toEqual({
			face: face('Inter', 'Bold'),
			missing: true
		});
		expect(resolveFont({ family: 'Inter', style: 'Bold Italic' }, faces, GEIST)).toEqual({
			face: face('Inter', 'Italic'),
			missing: true
		});
	});

	it('falls back to the bundled font, in the nearest style, for an unknown family', () => {
		expect(resolveFont({ family: 'Comic Nope', style: 'Bold' }, faces, GEIST)).toEqual({
			face: face('Geist', 'Bold', 'bundled'),
			missing: true
		});
		expect(resolveFont({ family: 'Comic Nope', style: 'Light' }, faces, GEIST).face.style).toBe(
			'Regular'
		);
	});

	it('does not throw for empty or odd references and leaves the reference untouched', () => {
		const ref = { family: '', style: '' };
		expect(resolveFont(ref, [], GEIST)).toMatchObject({ missing: true });
		expect(ref).toEqual({ family: '', style: '' });
	});

	it('refuses to run without any fallback face', () => {
		expect(() => resolveFont({ family: 'X', style: 'Y' }, [], [])).toThrow(/fallback/);
	});
});

describe('woffToSfnt', () => {
	const require = createRequire(import.meta.url);
	const path = require.resolve('@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff');

	it('unpacks a real bundled WOFF into a readable TrueType / OpenType file', async () => {
		const woff = new Uint8Array(readFileSync(path));
		const sfnt = await woffToSfnt(woff);
		const view = new DataView(sfnt.buffer);
		expect([0x00010000, 0x4f54544f]).toContain(view.getUint32(0));
		const name = await readFontName((offset, length) =>
			Promise.resolve(sfnt.subarray(offset, offset + length))
		);
		expect(name?.family).toBe('Geist');
		// every table lies inside the file
		const tableCount = view.getUint16(4);
		for (let index = 0; index < tableCount; index += 1) {
			const at = 12 + index * 16;
			expect(view.getUint32(at + 8) + view.getUint32(at + 12)).toBeLessThanOrEqual(sfnt.length);
		}
	});

	it('returns input that is not WOFF unchanged', async () => {
		const plain = new Uint8Array(64);
		expect(await woffToSfnt(plain)).toBe(plain);
	});
});
