// Pure file-system helpers of the library (data-model.md section 7): where the library lives,
// which names are acceptable, unique names, and directory listings. No Electron, no kernel.

import {
	copyFileSync,
	existsSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	type Dirent
} from 'node:fs';
import path from 'node:path';
import { FILE_EXTENSION } from './constants';

export const LIBRARY_DIRECTORY_NAME = 'draftboard';
export const LIBRARY_ENV_VARIABLE = 'DRAFTBOARD_LIBRARY_DIR';
export const MAX_NAME_LENGTH = 200;
/** Directories a listing never shows besides dot directories (version control, caches). */
const HIDDEN_DIRECTORY_NAMES = new Set(['node_modules']);

export type LibraryErrorCode = 'OUTSIDE_LIBRARY' | 'INVALID_NAME' | 'NOT_FOUND' | 'ALREADY_EXISTS';

/** Reads as a sentence: it reaches the user as the message of a failed IPC call. */
export class LibraryError extends Error {
	constructor(
		readonly code: LibraryErrorCode,
		message: string
	) {
		super(message);
		this.name = 'LibraryError';
	}
}

export interface LibraryLocationInput {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	/** `app.getPath('documents')`. */
	documentsPath: string;
	/** `app.getPath('home')`. */
	homePath: string;
}

/**
 * The library root: `DRAFTBOARD_LIBRARY_DIR`, else `$XDG_DATA_HOME/draftboard` (default
 * `~/.local/share/draftboard`) on Linux, else `Documents/Draftboard`.
 */
export function libraryRootFor(input: LibraryLocationInput): string {
	const override = input.env[LIBRARY_ENV_VARIABLE];
	if (override !== undefined && override !== '') return path.resolve(override);
	if (input.platform !== 'linux') return path.join(input.documentsPath, 'Draftboard');
	const dataHome = input.env.XDG_DATA_HOME;
	if (dataHome !== undefined && path.isAbsolute(dataHome)) {
		return path.join(dataHome, LIBRARY_DIRECTORY_NAME);
	}
	return path.join(input.homePath, '.local', 'share', LIBRARY_DIRECTORY_NAME);
}

/** A file or folder name the user typed: trimmed, and safe as one path segment. */
export function validateName(name: string): string {
	const trimmed = name.trim();
	if (trimmed === '') throw new LibraryError('INVALID_NAME', 'The name cannot be empty.');
	if (trimmed.length > MAX_NAME_LENGTH) {
		throw new LibraryError(
			'INVALID_NAME',
			`The name is longer than ${MAX_NAME_LENGTH} characters.`
		);
	}
	if (/[/\\\0]/.test(trimmed)) {
		throw new LibraryError('INVALID_NAME', 'The name cannot contain path separators.');
	}
	if (trimmed === '.' || trimmed.includes('..')) {
		throw new LibraryError('INVALID_NAME', 'The name cannot contain "..".');
	}
	return trimmed;
}

/** A document name for a file: `Name.ndesign` and `Name` both mean `Name`. */
export function validateFileName(name: string): string {
	const trimmed = validateName(name);
	const suffix = `.${FILE_EXTENSION}`;
	if (!trimmed.endsWith(suffix)) return trimmed;
	return validateName(trimmed.slice(0, -suffix.length));
}

export function isDesignFilePath(file: string): boolean {
	return path.extname(file) === `.${FILE_EXTENSION}`;
}

/** The file's name without directory and `.ndesign`. */
export function displayNameOf(file: string): string {
	return path.basename(file, path.extname(file));
}

export function withExtension(file: string): string {
	if (isDesignFilePath(file)) return file;
	return `${file}.${FILE_EXTENSION}`;
}

/** `base`, or `base 2`, `base 3`, ... : the first name not taken in `directory`. */
export function uniqueName(directory: string, base: string, extension: string): string {
	let candidate = base;
	let counter = 2;
	while (existsSync(path.join(directory, `${candidate}${extension}`))) {
		candidate = `${base} ${counter}`;
		counter += 1;
	}
	return candidate;
}

/** The real path when the target exists, else the resolved one. */
export function realOrResolved(target: string): string {
	try {
		return realpathSync(target);
	} catch {
		return path.resolve(target);
	}
}

export function isDirectory(target: string): boolean {
	try {
		return statSync(target).isDirectory();
	} catch {
		return false;
	}
}

export interface DirectoryContents {
	/** Subdirectory names, sorted; hidden ones left out. */
	folders: string[];
	/** Design file names (with extension), sorted. */
	files: string[];
}

function visibleDirectory(entry: Dirent): boolean {
	if (!entry.isDirectory()) return false;
	if (entry.name.startsWith('.')) return false;
	return !HIDDEN_DIRECTORY_NAMES.has(entry.name);
}

/** What is directly in `directory`; empty when it cannot be read. */
export function readDirectory(directory: string): DirectoryContents {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return { folders: [], files: [] };
	}
	const folders = entries.filter(visibleDirectory).map((entry) => entry.name);
	const files = entries
		.filter((entry) => entry.isFile() && isDesignFilePath(entry.name))
		.map((entry) => entry.name);
	return { folders: folders.sort(compareNames), files: files.sort(compareNames) };
}

function compareNames(left: string, right: string): number {
	return left.localeCompare(right);
}

/** Rename `from` to `to`; across file systems (a linked folder on another drive) copy and delete. */
export function moveFileSync(from: string, to: string): void {
	try {
		renameSync(from, to);
	} catch (error) {
		if (Reflect.get(Object(error), 'code') !== 'EXDEV') throw error;
		copyFileSync(from, to);
		rmSync(from, { force: true });
	}
}
