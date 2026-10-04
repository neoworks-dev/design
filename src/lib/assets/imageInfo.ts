// Reads an image's format and pixel size from its header, without decoding it. The size is the
// displayed size: a JPEG whose EXIF orientation is 5 to 8 is stored rotated by a quarter turn, so
// its width and height swap. Pure, so it runs in a worker and in tests.

export interface ImageInfo {
	mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
	/** Displayed width in pixels, after EXIF orientation. */
	width: number;
	/** Displayed height in pixels, after EXIF orientation. */
	height: number;
	/** EXIF orientation 1 to 8; 1 (upright) for formats and files without one. */
	orientation: number;
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readPng(bytes: Uint8Array): ImageInfo | null {
	if (bytes.length < 24 || ascii(bytes, 1, 3) !== 'PNG' || ascii(bytes, 12, 4) !== 'IHDR') {
		return null;
	}
	const data = view(bytes);
	return {
		mime: 'image/png',
		width: data.getUint32(16),
		height: data.getUint32(20),
		orientation: 1
	};
}

function readGif(bytes: Uint8Array): ImageInfo | null {
	if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'GIF') return null;
	const data = view(bytes);
	return {
		mime: 'image/gif',
		width: data.getUint16(6, true),
		height: data.getUint16(8, true),
		orientation: 1
	};
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
	if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
		return null;
	}
	const data = view(bytes);
	const chunk = ascii(bytes, 12, 4);
	if (chunk === 'VP8X') {
		const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
		const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
		return { mime: 'image/webp', width, height, orientation: 1 };
	}
	if (chunk === 'VP8L') {
		const packed = data.getUint32(21, true);
		return {
			mime: 'image/webp',
			width: 1 + (packed & 0x3fff),
			height: 1 + ((packed >> 14) & 0x3fff),
			orientation: 1
		};
	}
	if (chunk === 'VP8 ') {
		return {
			mime: 'image/webp',
			width: data.getUint16(26, true) & 0x3fff,
			height: data.getUint16(28, true) & 0x3fff,
			orientation: 1
		};
	}
	return null;
}

/** The orientation tag of an APP1 Exif segment starting at `start`, or 1. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
	if (ascii(bytes, start, 6) !== 'Exif\0\0') return 1;
	const tiff = start + 6;
	const data = view(bytes);
	const littleEndian = ascii(bytes, tiff, 2) === 'II';
	const firstIfd = tiff + data.getUint32(tiff + 4, littleEndian);
	if (firstIfd + 2 > end) return 1;
	const entries = data.getUint16(firstIfd, littleEndian);
	for (let index = 0; index < entries; index += 1) {
		const entry = firstIfd + 2 + index * 12;
		if (entry + 12 > end) return 1;
		if (data.getUint16(entry, littleEndian) !== 0x0112) continue;
		const value = data.getUint16(entry + 8, littleEndian);
		if (value >= 1 && value <= 8) return value;
		return 1;
	}
	return 1;
}

function isStartOfFrame(marker: number): boolean {
	if (marker === 0xc4 || marker === 0xc8 || marker === 0xcc) return false;
	return marker >= 0xc0 && marker <= 0xcf;
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	const data = view(bytes);
	let orientation = 1;
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		if (marker === 0xff) {
			offset += 1;
			continue;
		}
		const length = data.getUint16(offset + 2);
		const segmentEnd = offset + 2 + length;
		if (marker === 0xe1) orientation = exifOrientation(bytes, offset + 4, segmentEnd);
		if (isStartOfFrame(marker)) {
			if (offset + 9 > bytes.length) return null;
			const height = data.getUint16(offset + 5);
			const width = data.getUint16(offset + 7);
			const turned = orientation >= 5;
			return {
				mime: 'image/jpeg',
				width: turned ? height : width,
				height: turned ? width : height,
				orientation
			};
		}
		offset = segmentEnd;
	}
	return null;
}

/** The format and displayed size of `bytes`, or `null` when it is not a supported image. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
	const readers = [readPng, readJpeg, readGif, readWebp];
	for (const read of readers) {
		const info = read(bytes);
		if (info !== null && info.width > 0 && info.height > 0) return info;
	}
	return null;
}

/** Whether the larger side exceeds `maxDimension`; the image tool then asks to downscale. */
export function exceedsDimension(info: ImageInfo, maxDimension: number): boolean {
	return Math.max(info.width, info.height) > maxDimension;
}
