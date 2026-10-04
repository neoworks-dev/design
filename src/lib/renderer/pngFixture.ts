// Builds small PNG files for tests and fixtures: `pngBytes(width, height, (x, y) => [r, g, b, a])`.
// Only tests and the dev scene fixture import this (it uses Node's zlib).

import { deflateSync } from 'node:zlib';

export type Pixel = [number, number, number, number];

const CRC_TABLE: number[] = [];
for (let index = 0; index < 256; index += 1) {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		if ((value & 1) === 1) value = 0xedb88320 ^ (value >>> 1);
		else value = value >>> 1;
	}
	CRC_TABLE.push(value >>> 0);
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const result = new Uint8Array(12 + data.length);
	const view = new DataView(result.buffer);
	view.setUint32(0, data.length);
	for (let index = 0; index < 4; index += 1) result[4 + index] = type.charCodeAt(index);
	result.set(data, 8);
	view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
	return result;
}

export function pngBytes(
	width: number,
	height: number,
	pixelAt: (x: number, y: number) => Pixel
): Uint8Array {
	const header = new Uint8Array(13);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, width);
	headerView.setUint32(4, height);
	header[8] = 8;
	header[9] = 6;
	const stride = width * 4 + 1;
	const raw = new Uint8Array(stride * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) raw.set(pixelAt(x, y), y * stride + 1 + x * 4);
	}
	const parts = [
		new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', new Uint8Array(deflateSync(raw))),
		chunk('IEND', new Uint8Array(0))
	];
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}
