import { describe, expect, it } from 'vitest';
import { isSafeArchivePath, readZip, writeZip, ZipError, type ZipEntry } from './zip';

function text(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function entries(): ZipEntry[] {
	return [
		{ path: 'b/second.json', bytes: text('{"b":'.repeat(200)) },
		{ path: 'a.json', bytes: text('{"a":1}\n') },
		{ path: 'assets/blob.bin', bytes: new Uint8Array([0, 1, 2, 3, 255, 254]) },
		{ path: 'empty.txt', bytes: new Uint8Array() },
		{ path: 'unicode/Größe.json', bytes: text('ü') }
	];
}

function asMap(list: ZipEntry[]): Map<string, number[]> {
	return new Map(list.map((entry) => [entry.path, [...entry.bytes]]));
}

describe('zip', () => {
	it('round trips every entry byte for byte', () => {
		const read = readZip(writeZip(entries()));
		expect(asMap(read)).toEqual(asMap(entries()));
	});

	it('is deterministic: same entries in any order give identical bytes', () => {
		const forward = writeZip(entries());
		const reversed = writeZip([...entries()].reverse());
		expect(Buffer.from(forward).equals(Buffer.from(reversed))).toBe(true);
		expect(Buffer.from(forward).equals(Buffer.from(writeZip(entries())))).toBe(true);
	});

	it('lists entries sorted by path and compresses text', () => {
		const written = writeZip(entries());
		expect(readZip(written).map((entry) => entry.path)).toEqual([
			'a.json',
			'assets/blob.bin',
			'b/second.json',
			'empty.txt',
			'unicode/Größe.json'
		]);
		const raw = entries().reduce((total, entry) => total + entry.bytes.length, 0);
		expect(written.length).toBeLessThan(raw);
	});

	it('writes fixed timestamps so the output does not depend on the clock', () => {
		const written = Buffer.from(writeZip([{ path: 'a.json', bytes: text('x') }]));
		expect(written.readUInt16LE(10)).toBe(0);
		expect(written.readUInt16LE(12)).toBe(0x0021);
	});

	it('refuses unsafe and duplicate paths when writing', () => {
		for (const path of ['../evil', '/abs', 'a/../b', 'a\\b', 'C:/x', '', 'a//b', './a']) {
			expect(isSafeArchivePath(path)).toBe(false);
			expect(() => writeZip([{ path, bytes: text('x') }])).toThrow(ZipError);
		}
		expect(() =>
			writeZip([
				{ path: 'a', bytes: text('1') },
				{ path: 'a', bytes: text('2') }
			])
		).toThrow(/duplicate/);
	});

	it('refuses a zip-slip name when reading', () => {
		const written = Buffer.from(writeZip([{ path: 'aa/x', bytes: text('payload') }]));
		const evil = Buffer.from(written.toString('latin1').replaceAll('aa/x', '../x'), 'latin1');
		expect(() => readZip(evil)).toThrow(/unsafe path/);
	});

	it('detects a damaged payload through the checksum', () => {
		const written = Buffer.from(writeZip([{ path: 'a.bin', bytes: new Uint8Array([9, 8, 7, 6]) }]));
		const offset = written.indexOf(Buffer.from([9, 8, 7, 6]));
		written[offset] = 0;
		expect(() => readZip(written)).toThrow(/checksum/);
	});

	it('rejects input that is not a zip, or is cut short', () => {
		expect(() => readZip(text('not a zip at all, just some text'))).toThrow(ZipError);
		expect(() => readZip(new Uint8Array())).toThrow(ZipError);
		const written = writeZip(entries());
		expect(() => readZip(written.subarray(0, written.length - 30))).toThrow(ZipError);
	});

	it('does not inflate more than the directory announced (decompression bomb)', () => {
		const bomb = Buffer.from(writeZip([{ path: 'a.txt', bytes: text('a'.repeat(10000)) }]));
		// shrink the announced size in the central directory so the payload exceeds it
		const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		bomb.writeUInt32LE(10, central + 24);
		expect(() => readZip(bomb)).toThrow(ZipError);
	});
});
