import { Service, type Context } from '@neoworks/extension-system';
import type { Image } from 'canvaskit-wasm';
import { ImageCache, type ImageStatus } from '../../lib/renderer/imageCache';

declare module '@neoworks/extension-system' {
	interface Context {
		images: ImagesService;
	}
}

export interface ImagesSource {
	get(hash: string): Promise<Uint8Array | null>;
}

export interface ImagesOptions {
	budgetBytes: number;
	decode(bytes: Uint8Array): Promise<Image | null>;
}

export interface ImagesSnapshot {
	images: number;
	usedBytes: number;
	evictions: number;
}

/**
 * Decoded images for drawing, by content hash. `peek` is what a paint calls while drawing: the
 * image when it is decoded, otherwise undefined and the paint draws a placeholder; a frame is
 * requested (`renderer/need-frame`) once the image arrives.
 */
export class ImagesService extends Service {
	private readonly cache: ImageCache<Image>;

	constructor(ctx: Context, source: ImagesSource, options: ImagesOptions) {
		super(ctx, 'images');
		this.cache = new ImageCache<Image>({
			budgetBytes: options.budgetBytes,
			loadBytes: (hash) => source.get(hash),
			decode: (bytes) => options.decode(bytes),
			onSettled: () => ctx.emit('renderer/need-frame', 'image-ready')
		});
	}

	peek(hash: string): Image | undefined {
		return this.cache.peek(hash);
	}

	status(hash: string): ImageStatus {
		return this.cache.status(hash);
	}

	/** Drop one hash, or all; a missing image is tried again the next time it is drawn. */
	invalidate(hash?: string): void {
		this.cache.invalidate(hash);
	}

	get usedBytes(): number {
		return this.cache.usedBytes;
	}

	get budgetBytes(): number {
		return this.cache.budgetBytes;
	}

	dispose(): void {
		this.cache.dispose();
	}

	snapshotState(): ImagesSnapshot {
		return {
			images: this.cache.size,
			usedBytes: this.cache.usedBytes,
			evictions: this.cache.evictions
		};
	}
}
