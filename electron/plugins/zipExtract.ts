// Reading a plugin `.zip`: the central directory, stored and deflated entries, nothing else (no
// encryption, no zip64). Plugins are small bundles, so the whole archive is in memory; the limits
// keep a hostile archive (a zip bomb, a path that climbs out of the plugin directory) from doing
// harm.

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
	/** Forward slashes, relative, never containing `..`. */
	path: string;
	bytes: Uint8Array;
}

export class ZipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ZipError';
	}
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
export const MAX_ENTRIES = 5000;
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

function findEndOfCentralDirectory(view: DataView): number {
	const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
	for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
		if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
	}
	throw new ZipError('not a zip file');
}

function safePath(raw: string): string {
	const normalized = raw.replaceAll('\\', '/');
	const parts = normalized.split('/').filter((part) => part !== '' && part !== '.');
	if (normalized.startsWith('/') || parts.includes('..') || /^[A-Za-z]:/.test(normalized)) {
		throw new ZipError(`unsafe path "${raw}" in the archive`);
	}
	return parts.join('/');
}

function unpack(bytes: Uint8Array, method: number, size: number): Uint8Array {
	if (method === 0) return bytes;
	if (method !== 8) throw new ZipError(`unsupported compression method ${method}`);
	return inflateRawSync(bytes, { maxOutputLength: size + 1 });
}

/** Every file of the archive (directories are implied by the paths). */
export function readZip(archive: Uint8Array): ZipEntry[] {
	const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
	const end = findEndOfCentralDirectory(view);
	const count = view.getUint16(end + 10, true);
	if (count > MAX_ENTRIES) throw new ZipError(`more than ${MAX_ENTRIES} files in the archive`);
	let offset = view.getUint32(end + 16, true);
	const entries: ZipEntry[] = [];
	let total = 0;
	for (let index = 0; index < count; index += 1) {
		if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) {
			throw new ZipError('the archive directory is damaged');
		}
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const size = view.getUint32(offset + 24, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const rawName = new TextDecoder().decode(
			archive.subarray(offset + 46, offset + 46 + nameLength)
		);
		offset += 46 + nameLength + extraLength + commentLength;
		if (rawName.endsWith('/')) continue;
		total += size;
		if (total > MAX_UNPACKED_BYTES) throw new ZipError('the archive unpacks to more than 64 MB');
		if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
			throw new ZipError(`the entry "${rawName}" is damaged`);
		}
		const dataStart =
			localOffset +
			30 +
			view.getUint16(localOffset + 26, true) +
			view.getUint16(localOffset + 28, true);
		const compressed = archive.subarray(dataStart, dataStart + compressedSize);
		entries.push({ path: safePath(rawName), bytes: unpack(compressed, method, size) });
	}
	return entries;
}

/** Drop the one folder every path shares (`my-plugin/manifest.json` becomes `manifest.json`). */
export function stripCommonRoot(entries: ZipEntry[]): ZipEntry[] {
	if (entries.length === 0) return entries;
	if (entries.some((entry) => entry.path === 'manifest.json')) return entries;
	const roots = new Set(entries.map((entry) => entry.path.split('/')[0]));
	if (roots.size !== 1) return entries;
	const [root] = roots;
	return entries.map((entry) => ({ ...entry, path: entry.path.slice(root.length + 1) }));
}
