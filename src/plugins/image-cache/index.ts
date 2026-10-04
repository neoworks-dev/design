import type { Context } from '@neoworks/extension-system';
import { decodeSkiaImage } from '../../lib/renderer/skiaImage';
import { ImagesService, type ImagesOptions } from './service';

const MEGABYTE = 1024 * 1024;
const DEFAULT_BUDGET_MEGABYTES = 256;

export interface ImageCacheConfig {
	/** Decoded-image budget in megabytes (mip levels included). Default 256. */
	budgetMegabytes?: number;
	/** Decoder; tests substitute a counting fake. Defaults to Skia with `createImageBitmap`. */
	decode?: ImagesOptions['decode'];
}

// Provides `images`: decoded Skia images by content hash, LRU-evicted under a byte budget, with
// bytes from `blobs`. Images are deleted when evicted, when a file is attached and on unload.
export default {
	name: 'image-cache',
	inject: ['blobs', 'canvaskit'],
	apply(ctx: Context, config?: ImageCacheConfig): void {
		const { kit, tracker } = ctx.canvaskit;
		let budgetMegabytes = DEFAULT_BUDGET_MEGABYTES;
		if (config && config.budgetMegabytes !== undefined) budgetMegabytes = config.budgetMegabytes;
		const decode =
			config && config.decode
				? config.decode
				: (bytes: Uint8Array) => decodeSkiaImage(kit, tracker, bytes);
		const images = new ImagesService(ctx, ctx.blobs, {
			budgetBytes: budgetMegabytes * MEGABYTE,
			decode
		});

		ctx.on('file/attached', () => images.invalidate());
		ctx.effect(() => () => images.dispose(), 'image-cache/decoded images');
	}
};
