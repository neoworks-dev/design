// Decoded images by content hash, with an LRU byte budget (docs/research/rendering.md,
// recommendation 7). Pure of kernel and Skia: the loader, the decoder and what an "image" is are
// injected, so the same cache serves CanvasKit images and tests with counters.
//
// Drawing never waits: `peek` returns the decoded image when there is one, otherwise it starts
// loading and returns undefined, and the caller draws a placeholder. `onSettled` fires when a
// load finishes (decoded or missing) so the renderer can ask for a frame.
//
// Eviction deletes the image. It only happens when a decode finishes, which is between frames
// (frames are synchronous), so a frame never draws an image that was just deleted.

export interface CachedImage {
	width(): number;
	height(): number;
	delete(): void;
}

export type ImageStatus = 'ready' | 'loading' | 'missing';

export interface ImageCacheOptions<Image extends CachedImage> {
	/** Evict least recently used images while the decoded total is above this. */
	budgetBytes: number;
	/** Encoded bytes for a hash; null when the file does not hold them. */
	loadBytes(hash: string): Promise<Uint8Array | null>;
	/** Decode (and build mip levels); null when the bytes are not an image. */
	decode(bytes: Uint8Array): Promise<Image | null>;
	/** A hash finished loading, successfully or not. */
	onSettled(hash: string): void;
}

interface Entry<Image> {
	image: Image;
	bytes: number;
}

/** Mip levels add a third on top of the base level. */
const MIP_OVERHEAD = 4 / 3;
const BYTES_PER_PIXEL = 4;

export function decodedBytes(width: number, height: number): number {
	return Math.ceil(width * height * BYTES_PER_PIXEL * MIP_OVERHEAD);
}

export class ImageCache<Image extends CachedImage> {
	/** Insertion order is recency order: the first entry is the least recently used. */
	private readonly entries = new Map<string, Entry<Image>>();
	private readonly pending = new Set<string>();
	private readonly missing = new Set<string>();
	private used = 0;
	private disposed = false;
	private evictedCount = 0;

	constructor(private readonly options: ImageCacheOptions<Image>) {}

	get usedBytes(): number {
		return this.used;
	}

	get size(): number {
		return this.entries.size;
	}

	get evictions(): number {
		return this.evictedCount;
	}

	get budgetBytes(): number {
		return this.options.budgetBytes;
	}

	status(hash: string): ImageStatus {
		if (this.entries.has(hash)) return 'ready';
		if (this.missing.has(hash)) return 'missing';
		return 'loading';
	}

	/** The decoded image, marked as recently used; otherwise starts loading it. */
	peek(hash: string): Image | undefined {
		const entry = this.entries.get(hash);
		if (entry) {
			this.entries.delete(hash);
			this.entries.set(hash, entry);
			return entry.image;
		}
		this.startLoading(hash);
		return undefined;
	}

	/** Forget one hash (or everything): decoded images are deleted, missing ones may be retried. */
	invalidate(hash?: string): void {
		if (hash === undefined) {
			for (const key of this.entries.keys()) this.drop(key);
			this.missing.clear();
			return;
		}
		this.drop(hash);
		this.missing.delete(hash);
	}

	dispose(): void {
		this.disposed = true;
		this.invalidate();
	}

	private startLoading(hash: string): void {
		if (this.disposed || this.missing.has(hash) || this.pending.has(hash)) return;
		this.pending.add(hash);
		this.load(hash).catch(() => undefined);
	}

	private async load(hash: string): Promise<void> {
		try {
			await this.loadAndDecode(hash);
		} catch {
			this.pending.delete(hash);
			this.settleMissing(hash);
		} finally {
			this.pending.delete(hash);
		}
	}

	private async loadAndDecode(hash: string): Promise<void> {
		const bytes = await this.options.loadBytes(hash);
		if (bytes === null) {
			this.settleMissing(hash);
			return;
		}
		const image = await this.options.decode(bytes);
		if (image === null) {
			this.settleMissing(hash);
			return;
		}
		this.settleDecoded(hash, image);
	}

	private settleMissing(hash: string): void {
		if (this.disposed) return;
		this.missing.add(hash);
		this.options.onSettled(hash);
	}

	private settleDecoded(hash: string, image: Image): void {
		if (this.disposed) {
			image.delete();
			return;
		}
		this.drop(hash);
		const bytes = decodedBytes(image.width(), image.height());
		this.entries.set(hash, { image, bytes });
		this.used += bytes;
		this.evictOver(hash);
		this.options.onSettled(hash);
	}

	/** Evicts oldest first, never `keep` (an image larger than the budget stays alone). */
	private evictOver(keep: string): void {
		for (const hash of this.entries.keys()) {
			if (this.used <= this.options.budgetBytes) return;
			if (hash === keep) continue;
			this.drop(hash);
			this.evictedCount += 1;
		}
	}

	private drop(hash: string): void {
		const entry = this.entries.get(hash);
		if (!entry) return;
		this.entries.delete(hash);
		this.used -= entry.bytes;
		entry.image.delete();
	}
}
