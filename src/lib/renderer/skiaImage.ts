// Encoded bytes to a Skia image with mip levels. `createImageBitmap` decodes off the main thread
// where the browser can; Skia's own decoder is the fallback (and what runs under Node in tests).

import type { CanvasKit, Image } from 'canvaskit-wasm';
import type { SkiaTracker } from './ownership';

async function decodeWithBitmap(canvasKit: CanvasKit, bytes: Uint8Array): Promise<Image | null> {
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
	try {
		return canvasKit.MakeImageFromCanvasImageSource(bitmap);
	} finally {
		bitmap.close();
	}
}

async function decodeBase(canvasKit: CanvasKit, bytes: Uint8Array): Promise<Image | null> {
	if (typeof createImageBitmap === 'function') {
		try {
			const image = await decodeWithBitmap(canvasKit, bytes);
			if (image !== null) return image;
		} catch {
			// not decodable by the browser; Skia gets its turn
		}
	}
	return canvasKit.MakeImageFromEncoded(bytes);
}

/** The image is tracked (counted by the leak counter) and carries default mip levels. */
export async function decodeSkiaImage(
	canvasKit: CanvasKit,
	tracker: SkiaTracker,
	bytes: Uint8Array
): Promise<Image | null> {
	const base = await decodeBase(canvasKit, bytes);
	if (base === null) return null;
	const mipmapped = base.makeCopyWithDefaultMipmaps();
	base.delete();
	return tracker.track(mipmapped);
}
