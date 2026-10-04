// Builds small PNG files for tests and fixtures: `pngBytes(width, height, (x, y) => [r, g, b, a])`.
// Pure and synchronous (zlib "stored" blocks, no compression), so the dev scene fixture can use
// it in the browser too.

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

const STORED_BLOCK_LIMIT = 65535;

function adler32(bytes: Uint8Array): number {
	let low = 1;
	let high = 0;
	for (const byte of bytes) {
		low = (low + byte) % 65521;
		high = (high + low) % 65521;
	}
	return ((high << 16) | low) >>> 0;
}

/** A zlib stream made of uncompressed blocks: valid, larger than needed, trivial to produce. */
function zlibStored(data: Uint8Array): Uint8Array {
	const blockCount = Math.max(1, Math.ceil(data.length / STORED_BLOCK_LIMIT));
	const result = new Uint8Array(2 + data.length + blockCount * 5 + 4);
	const view = new DataView(result.buffer);
	result.set([0x78, 0x01], 0);
	let offset = 2;
	for (let block = 0; block < blockCount; block += 1) {
		const start = block * STORED_BLOCK_LIMIT;
		const length = Math.min(STORED_BLOCK_LIMIT, data.length - start);
		result[offset] = block === blockCount - 1 ? 1 : 0;
		view.setUint16(offset + 1, length, true);
		view.setUint16(offset + 3, ~length & 0xffff, true);
		result.set(data.subarray(start, start + length), offset + 5);
		offset += 5 + length;
	}
	view.setUint32(offset, adler32(data));
	return result;
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
		chunk('IDAT', zlibStored(raw)),
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
