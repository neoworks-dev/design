import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fontDirectories, scanFonts } from './scan';
import { readFontName, type ByteReader } from './sfnt';
import { buildSfnt, simpleFont } from './testFont';

function readerOf(bytes: Uint8Array): ByteReader {
	return (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length));
}

describe('readFontName', () => {
	it('reads family and style from the Windows English name records', async () => {
		expect(await readFontName(readerOf(simpleFont('Inter', 'Bold Italic')))).toEqual({
			family: 'Inter',
			style: 'Bold Italic'
		});
	});

	it('prefers the typographic family and style (ids 16 and 17) over the legacy ones', async () => {
		const bytes = buildSfnt([
			{ platform: 3, language: 0x409, nameId: 1, text: 'Acme Semibold' },
			{ platform: 3, language: 0x409, nameId: 2, text: 'Regular' },
			{ platform: 3, language: 0x409, nameId: 16, text: 'Acme' },
			{ platform: 3, language: 0x409, nameId: 17, text: 'Semibold' }
		]);
		expect(await readFontName(readerOf(bytes))).toEqual({ family: 'Acme', style: 'Semibold' });
	});

	it('falls back to Macintosh records and to Regular when there is no style', async () => {
		const bytes = buildSfnt([{ platform: 1, language: 0, nameId: 1, text: 'Old Mac' }]);
		expect(await readFontName(readerOf(bytes))).toEqual({ family: 'Old Mac', style: 'Regular' });
	});

	it('prefers English over other Windows languages', async () => {
		const bytes = buildSfnt([
			{ platform: 3, language: 0x407, nameId: 1, text: 'Schrift' },
			{ platform: 3, language: 0x409, nameId: 1, text: 'Font' }
		]);
		expect((await readFontName(readerOf(bytes)))?.family).toBe('Font');
	});

	it('returns null for collections, non-fonts and truncated files', async () => {
		expect(await readFontName(readerOf(buildSfnt([], 0x74746366)))).toBeNull();
		expect(await readFontName(readerOf(new TextEncoder().encode('not a font at all')))).toBeNull();
		expect(await readFontName(readerOf(new Uint8Array([0, 1])))).toBeNull();
		expect(await readFontName(readerOf(simpleFont('Cut', 'Off').subarray(0, 20)))).toBeNull();
		expect(await readFontName(readerOf(buildSfnt([])))).toBeNull();
	});
});

describe('scanFonts', () => {
	const directories: string[] = [];
	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function makeDirectory(): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-test-'));
		directories.push(directory);
		return directory;
	}

	it('finds fonts recursively, skips junk, dedupes by family and style, and sorts', async () => {
		const root = makeDirectory();
		fs.mkdirSync(path.join(root, 'nested'));
		fs.writeFileSync(path.join(root, 'b.ttf'), simpleFont('Beta', 'Regular'));
		fs.writeFileSync(path.join(root, 'nested', 'a-bold.otf'), simpleFont('Alpha', 'Bold'));
		fs.writeFileSync(path.join(root, 'nested', 'a-dup.ttf'), simpleFont('alpha', 'bold'));
		fs.writeFileSync(path.join(root, 'broken.ttf'), 'garbage');
		fs.writeFileSync(path.join(root, 'readme.txt'), 'hello');
		const found = await scanFonts([root, path.join(root, 'does-not-exist')]);
		expect(found.map((font) => [font.family, font.style])).toEqual([
			['Alpha', 'Bold'],
			['Beta', 'Regular']
		]);
		expect(found[0].file.startsWith(root)).toBe(true);
	});

	it('names the platform font directories', () => {
		expect(fontDirectories('linux', '/home/u', {})).toContain('/home/u/.local/share/fonts');
		expect(fontDirectories('darwin', '/Users/u', {})).toContain('/Users/u/Library/Fonts');
		expect(fontDirectories('win32', 'C:\\Users\\u', { WINDIR: 'D:\\Win' }).join('|')).toContain(
			'Fonts'
		);
	});
});
