// Finds the installed fonts by walking the platform's font directories and reading each file's
// `name` table. No native module and no `fc-list`: one code path for Linux, macOS and Windows.

import fs from 'node:fs';
import path from 'node:path';
import { readFontName } from './sfnt';

export interface SystemFontFile {
	family: string;
	style: string;
	/** Absolute path of the font file; stays in main, the renderer only sees family and style. */
	file: string;
}

const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

export function fontDirectories(
	platform: NodeJS.Platform,
	home: string,
	env: Record<string, string | undefined>
): string[] {
	if (platform === 'darwin') {
		return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')];
	}
	if (platform === 'win32') {
		const windir = env.WINDIR === undefined ? 'C:\\Windows' : env.WINDIR;
		const local =
			env.LOCALAPPDATA === undefined ? path.join(home, 'AppData/Local') : env.LOCALAPPDATA;
		return [path.join(windir, 'Fonts'), path.join(local, 'Microsoft/Windows/Fonts')];
	}
	return [
		'/usr/share/fonts',
		'/usr/local/share/fonts',
		path.join(home, '.fonts'),
		path.join(home, '.local/share/fonts')
	];
}

async function listFontFiles(directory: string): Promise<string[]> {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await listFontFiles(full)));
		else if (FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
	}
	return files;
}

async function describeFile(file: string): Promise<SystemFontFile | null> {
	let handle: fs.promises.FileHandle;
	try {
		handle = await fs.promises.open(file, 'r');
	} catch {
		return null;
	}
	try {
		const name = await readFontName(async (offset, length) => {
			const buffer = new Uint8Array(length);
			const { bytesRead } = await handle.read(buffer, 0, length, offset);
			return buffer.subarray(0, bytesRead);
		});
		if (name === null) return null;
		return { ...name, file };
	} catch {
		return null;
	} finally {
		await handle.close();
	}
}

/** Every readable font under `directories`, one entry per family and style (first wins), sorted. */
export async function scanFonts(directories: string[]): Promise<SystemFontFile[]> {
	const unique = new Map<string, SystemFontFile>();
	for (const directory of directories) {
		const files = await listFontFiles(directory);
		const described = await Promise.all(files.map((file) => describeFile(file)));
		for (const item of described) {
			if (item === null) continue;
			const key = `${item.family}\u0000${item.style}`.toLowerCase();
			if (!unique.has(key)) unique.set(key, item);
		}
	}
	return [...unique.values()].sort(
		(left, right) =>
			left.family.localeCompare(right.family) || left.style.localeCompare(right.style)
	);
}
