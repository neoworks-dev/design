import { describe, expect, it } from 'vitest';
import { exceedsDimension, readImageInfo } from './imageInfo';

function png(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(33);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
	const data = new DataView(bytes.buffer);
	data.setUint32(8, 13);
	bytes.set([73, 72, 68, 82], 12);
	data.setUint32(16, width);
	data.setUint32(20, height);
	return bytes;
}

/** A JPEG with an optional EXIF orientation and a baseline frame of `width` x `height`. */
function jpeg(width: number, height: number, orientation?: number): Uint8Array {
	const parts: number[] = [0xff, 0xd8];
	if (orientation !== undefined) {
		const tiff = [
			0x4d,
			0x4d,
			0,
			42,
			0,
			0,
			0,
			8,
			0,
			1,
			0x01,
			0x12,
			0,
			3,
			0,
			0,
			0,
			1,
			0,
			orientation,
			0,
			0,
			0,
			0,
			0,
			0
		];
		const body = [...Array.from('Exif\0\0', (character) => character.charCodeAt(0)), ...tiff];
		const length = body.length + 2;
		parts.push(0xff, 0xe1, length >> 8, length & 0xff, ...body);
	}
	parts.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3);
	parts.push(...Array.from({ length: 9 }, () => 0));
	return new Uint8Array(parts);
}

describe('readImageInfo', () => {
	it('reads a PNG header', () => {
		expect(readImageInfo(png(640, 480))).toEqual({
			mime: 'image/png',
			width: 640,
			height: 480,
			orientation: 1
		});
	});

	it('reads a JPEG frame without EXIF as upright', () => {
		expect(readImageInfo(jpeg(300, 200))).toMatchObject({
			width: 300,
			height: 200,
			orientation: 1
		});
	});

	it('swaps width and height for a JPEG stored rotated by EXIF orientation 6', () => {
		expect(readImageInfo(jpeg(300, 200, 6))).toEqual({
			mime: 'image/jpeg',
			width: 200,
			height: 300,
			orientation: 6
		});
	});

	it('keeps the size for a flipped but not turned orientation (2)', () => {
		expect(readImageInfo(jpeg(300, 200, 2))).toMatchObject({ width: 300, height: 200 });
	});

	it('reads GIF and WebP (lossless) headers', () => {
		const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 10, 0, 20, 0]);
		expect(readImageInfo(gif)).toMatchObject({ mime: 'image/gif', width: 10, height: 20 });
		const webp = new Uint8Array(30);
		webp.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76], 0);
		new DataView(webp.buffer).setUint32(21, 99 | (49 << 14), true);
		expect(readImageInfo(webp)).toMatchObject({ mime: 'image/webp', width: 100, height: 50 });
	});

	it('returns null for anything else', () => {
		expect(readImageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
		expect(readImageInfo(new TextEncoder().encode('<svg></svg>'))).toBeNull();
	});

	it('reports whether an image exceeds a size policy', () => {
		const info = readImageInfo(png(4000, 100));
		if (info === null) throw new Error('png not read');
		expect(exceedsDimension(info, 2048)).toBe(true);
		expect(exceedsDimension(info, 4000)).toBe(false);
	});
});
