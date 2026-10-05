// A small zip writer and reader for design archives (#31). Only what the archive needs: files,
// deflate or store, UTF-8 names, no zip64, no encryption, no directories.
//
// Writing is deterministic: entries are sorted by name, every timestamp is 1980-01-01, attributes
// are fixed and deflate runs at a fixed level, so identical entries give identical bytes (for one
// zlib build). Reading is defensive because archives come from outside: names must be plain
// relative paths (no `..`, no absolute paths, no backslashes), sizes are capped before anything is
// inflated, and every CRC is checked.

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
	/** Forward slashes, relative, no `.` or `..` segments. */
	path: string;
	bytes: Uint8Array;
}

export class ZipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ZipError';
	}
}

/** One entry larger than this is refused when reading (the same cap as image and font blobs). */
export const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 100_000;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const VERSION_NEEDED = 20;
const FLAG_UTF8_NAME = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** 1980-01-01 00:00:00 in MS-DOS date and time fields. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;
const DEFLATE_LEVEL = 9;
const UINT16_LIMIT = 0xffff;
const UINT32_LIMIT = 0xffffffff;

/** Whether `path` is safe to create inside a folder: relative, forward slashes, no `..`. */
export function isSafeArchivePath(path: string): boolean {
	if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0'))
		return false;
	if (/^[A-Za-z]:/.test(path)) return false;
	return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function compareBytes(left: string, right: string): number {
	return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

interface PreparedEntry {
	name: Buffer;
	method: number;
	crc: number;
	size: number;
	data: Buffer;
	offset: number;
}

function prepare(entry: ZipEntry): Omit<PreparedEntry, 'offset'> {
	if (!isSafeArchivePath(entry.path)) throw new ZipError(`unsafe path in archive: ${entry.path}`);
	const raw = Buffer.from(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength);
	if (raw.length >= UINT32_LIMIT) throw new ZipError(`${entry.path} is too large for a zip`);
	const deflated = deflateRawSync(raw, { level: DEFLATE_LEVEL });
	const useDeflate = deflated.length < raw.length;
	return {
		name: Buffer.from(entry.path, 'utf8'),
		method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
		crc: crc32(raw),
		size: raw.length,
		data: useDeflate ? deflated : raw
	};
}

function localHeader(entry: PreparedEntry): Buffer {
	const header = Buffer.alloc(30);
	header.writeUInt32LE(LOCAL_HEADER, 0);
	header.writeUInt16LE(VERSION_NEEDED, 4);
	header.writeUInt16LE(FLAG_UTF8_NAME, 6);
	header.writeUInt16LE(entry.method, 8);
	header.writeUInt16LE(DOS_TIME, 10);
	header.writeUInt16LE(DOS_DATE, 12);
	header.writeUInt32LE(entry.crc, 14);
	header.writeUInt32LE(entry.data.length, 18);
	header.writeUInt32LE(entry.size, 22);
	header.writeUInt16LE(entry.name.length, 26);
	header.writeUInt16LE(0, 28);
	return header;
}

function centralHeader(entry: PreparedEntry): Buffer {
	const header = Buffer.alloc(46);
	header.writeUInt32LE(CENTRAL_HEADER, 0);
	header.writeUInt16LE(VERSION_NEEDED, 4);
	header.writeUInt16LE(VERSION_NEEDED, 6);
	header.writeUInt16LE(FLAG_UTF8_NAME, 8);
	header.writeUInt16LE(entry.method, 10);
	header.writeUInt16LE(DOS_TIME, 12);
	header.writeUInt16LE(DOS_DATE, 14);
	header.writeUInt32LE(entry.crc, 16);
	header.writeUInt32LE(entry.data.length, 20);
	header.writeUInt32LE(entry.size, 24);
	header.writeUInt16LE(entry.name.length, 28);
	header.writeUInt32LE(entry.offset, 42);
	return header;
}

/** The bytes of a zip holding `entries`, sorted by path. Duplicate paths are refused. */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
	if (entries.length >= UINT16_LIMIT) throw new ZipError('too many files for a zip');
	const sorted = [...entries].sort((left, right) => compareBytes(left.path, right.path));
	const chunks: Buffer[] = [];
	const prepared: PreparedEntry[] = [];
	let offset = 0;
	for (const entry of sorted) {
		if (prepared.length > 0 && prepared[prepared.length - 1].name.toString('utf8') === entry.path) {
			throw new ZipError(`duplicate path in archive: ${entry.path}`);
		}
		const ready = { ...prepare(entry), offset };
		const header = localHeader(ready);
		chunks.push(header, ready.name, ready.data);
		offset += header.length + ready.name.length + ready.data.length;
		prepared.push(ready);
	}
	const directoryStart = offset;
	for (const entry of prepared) {
		const header = centralHeader(entry);
		chunks.push(header, entry.name);
		offset += header.length + entry.name.length;
	}
	const end = Buffer.alloc(22);
	end.writeUInt32LE(END_OF_DIRECTORY, 0);
	end.writeUInt16LE(prepared.length, 8);
	end.writeUInt16LE(prepared.length, 10);
	end.writeUInt32LE(offset - directoryStart, 12);
	end.writeUInt32LE(directoryStart, 16);
	chunks.push(end);
	return new Uint8Array(Buffer.concat(chunks));
}

function findEndOfDirectory(data: Buffer): number {
	const earliest = Math.max(0, data.length - 22 - UINT16_LIMIT);
	for (let position = data.length - 22; position >= earliest; position -= 1) {
		if (data.readUInt32LE(position) === END_OF_DIRECTORY) return position;
	}
	throw new ZipError('not a zip file (no end of central directory)');
}

interface CentralRecord {
	name: string;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

function readCentralDirectory(data: Buffer): CentralRecord[] {
	const end = findEndOfDirectory(data);
	const count = data.readUInt16LE(end + 10);
	const start = data.readUInt32LE(end + 16);
	if (count > MAX_ENTRY_COUNT) throw new ZipError('too many files in the archive');
	const records: CentralRecord[] = [];
	let position = start;
	for (let index = 0; index < count; index += 1) {
		if (position + 46 > data.length || data.readUInt32LE(position) !== CENTRAL_HEADER) {
			throw new ZipError('the zip directory is damaged');
		}
		const nameLength = data.readUInt16LE(position + 28);
		const extraLength = data.readUInt16LE(position + 30);
		const commentLength = data.readUInt16LE(position + 32);
		const flags = data.readUInt16LE(position + 8);
		if ((flags & 1) !== 0) throw new ZipError('encrypted zip files are not supported');
		const nameEnd = position + 46 + nameLength;
		if (nameEnd > data.length) throw new ZipError('the zip directory is damaged');
		records.push({
			name: data.toString('utf8', position + 46, nameEnd),
			method: data.readUInt16LE(position + 10),
			crc: data.readUInt32LE(position + 16),
			compressedSize: data.readUInt32LE(position + 20),
			size: data.readUInt32LE(position + 24),
			localOffset: data.readUInt32LE(position + 42)
		});
		position = nameEnd + extraLength + commentLength;
	}
	return records;
}

function readEntry(data: Buffer, record: CentralRecord): ZipEntry {
	if (!isSafeArchivePath(record.name)) throw new ZipError(`unsafe path in archive: ${record.name}`);
	if (record.size === UINT32_LIMIT || record.compressedSize === UINT32_LIMIT) {
		throw new ZipError('zip64 archives are not supported');
	}
	if (record.size > MAX_ENTRY_BYTES) throw new ZipError(`${record.name} is too large`);
	const local = record.localOffset;
	if (local + 30 > data.length || data.readUInt32LE(local) !== LOCAL_HEADER) {
		throw new ZipError(`the entry ${record.name} is damaged`);
	}
	const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
	const stored = data.subarray(start, start + record.compressedSize);
	if (stored.length !== record.compressedSize) throw new ZipError(`${record.name} is truncated`);
	const bytes = unpack(stored, record);
	if (bytes.length !== record.size) throw new ZipError(`${record.name} has the wrong size`);
	if (crc32(bytes) !== record.crc) throw new ZipError(`${record.name} fails its checksum`);
	return { path: record.name, bytes: new Uint8Array(bytes) };
}

function unpack(stored: Buffer, record: CentralRecord): Buffer {
	if (record.method === METHOD_STORE) return stored;
	if (record.method !== METHOD_DEFLATE) {
		throw new ZipError(`${record.name} uses an unsupported compression method`);
	}
	try {
		return inflateRawSync(stored, { maxOutputLength: Math.max(record.size, 1) });
	} catch {
		throw new ZipError(`${record.name} cannot be decompressed`);
	}
}

/** The files of a zip. Throws `ZipError` for anything malformed, unsafe or too large. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
	const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (data.length < 22) throw new ZipError('not a zip file');
	const seen = new Set<string>();
	const entries: ZipEntry[] = [];
	let total = 0;
	for (const record of readCentralDirectory(data)) {
		if (record.name.endsWith('/') && record.size === 0) continue;
		if (seen.has(record.name)) throw new ZipError(`duplicate path in archive: ${record.name}`);
		seen.add(record.name);
		total += record.size;
		if (total > MAX_ENTRY_BYTES * 4) throw new ZipError('the archive is too large');
		entries.push(readEntry(data, record));
	}
	return entries;
}
