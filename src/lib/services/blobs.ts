// The renderer's `blobs` service: content-addressed bytes for images and embedded fonts, stored in
// the open file by main (`assets` and `fonts` tables).
//
// Adding an image is two steps that the caller composes: `put` stores the bytes in main and
// returns the asset `record` plus the `changes` that add it to the document (empty when the
// document already has it). The caller applies those changes in the same `document.apply` as the
// paint that refers to the hash, so one import is one undo step. Bytes come back with `get`,
// cached per hash for the image cache of the renderer.
//
// Embedded fonts go through the existing `fonts` service (`ctx.fonts.embed`); this service only
// persists the file and restores the faces when a file is attached.

import { Service, type Context } from '@neoworks/extension-system';
import type { AssetPutRequest, AssetPutResult, FontRef } from '../../../electron/bridge';
import { exceedsDimension, readImageInfo, type ImageInfo } from '../assets/imageInfo';
import type { AssetRecord, Change } from '../document';

export interface BlobsDesktop {
	assetsPut(request: AssetPutRequest): Promise<AssetPutResult>;
	assetsGet(hash: string): Promise<Uint8Array | null>;
	assetsCollect(): Promise<string[]>;
	assetsEmbedFont(ref: FontRef, bytes: Uint8Array): Promise<void>;
	assetsFontBytes(ref: FontRef): Promise<Uint8Array | null>;
	assetsEmbeddedFonts(): Promise<FontRef[]>;
}

export interface BlobsDocument {
	getEntity(kind: 'asset', id: string): AssetRecord | undefined;
	addEntity(kind: 'asset', entity: AssetRecord): Change[];
}

export interface BlobsFonts {
	embed(ref: FontRef, bytes: ArrayBuffer): () => Promise<void>;
}

export interface PutOptions {
	/** Larger images are flagged `oversized`; shrinking them needs a decoder (the image tool's job). */
	maxDimension?: number;
}

export interface StoredBlob {
	/** The sha-256 of the bytes: what `ImagePaint.imageHash` holds. */
	hash: string;
	record: AssetRecord;
	/** False when the file already held these bytes. */
	created: boolean;
	/** Adds `record` to the document; empty when it is already there. Apply with the paint. */
	changes: Change[];
	/** Larger than `PutOptions.maxDimension`. */
	oversized: boolean;
	info: ImageInfo;
}

export class BlobsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BlobsError';
	}
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function faceKey(ref: FontRef): string {
	return `${ref.family}\u0000${ref.style}`;
}

export class BlobsService extends Service {
	private readonly cache = new Map<string, Promise<Uint8Array | null>>();
	private readonly embeddedDisposers = new Map<string, () => Promise<void>>();

	constructor(
		ctx: Context,
		private readonly desktop: BlobsDesktop,
		private readonly document: BlobsDocument,
		private readonly fonts: BlobsFonts
	) {
		super(ctx, 'blobs');
	}

	/** Store an image (png, jpeg, gif or webp) and describe how to add it to the document. */
	async put(bytes: Uint8Array, options: PutOptions = {}): Promise<StoredBlob> {
		const info = readImageInfo(bytes);
		if (info === null) throw new BlobsError('not a supported image (png, jpeg, gif, webp)');
		const stored = await this.desktop.assetsPut({
			mime: info.mime,
			bytes,
			width: info.width,
			height: info.height
		});
		this.cache.set(stored.record.id, Promise.resolve(bytes));
		return {
			hash: stored.record.id,
			record: stored.record,
			created: stored.created,
			changes: this.changesFor(stored.record),
			oversized: this.isOversized(info, options),
			info
		};
	}

	/** Image bytes by hash, fetched once from main; `null` when the file does not hold them. */
	get(hash: string): Promise<Uint8Array | null> {
		const cached = this.cache.get(hash);
		if (cached !== undefined) return cached;
		const pending = this.desktop.assetsGet(hash);
		this.cache.set(hash, pending);
		pending.catch(() => this.cache.delete(hash));
		return pending;
	}

	/** Remove unreferenced stored images now (Save does this too); forgets their cached bytes. */
	async collect(): Promise<string[]> {
		const removed = await this.desktop.assetsCollect();
		for (const hash of removed) this.cache.delete(hash);
		return removed;
	}

	/** Persist a font file in the open file and make the face available as an embedded one. */
	async embedFont(ref: FontRef, bytes: Uint8Array): Promise<void> {
		await this.desktop.assetsEmbedFont(ref, bytes);
		await this.registerEmbedded(ref, bytes);
	}

	/** Register every font the open file carries bytes for with the `fonts` service. */
	async restoreEmbeddedFonts(): Promise<void> {
		await this.releaseEmbedded();
		for (const ref of await this.desktop.assetsEmbeddedFonts()) {
			const bytes = await this.desktop.assetsFontBytes(ref);
			if (bytes === null) continue;
			await this.registerEmbedded(ref, bytes);
		}
	}

	/** A different file is attached: cached bytes belong to the old one. */
	forgetCache(): void {
		this.cache.clear();
	}

	/** Drop cached bytes and unregister embedded faces (plugin unmount). */
	async dispose(): Promise<void> {
		this.cache.clear();
		await this.releaseEmbedded();
	}

	snapshotState(): unknown {
		return { cached: this.cache.size, embeddedFonts: this.embeddedDisposers.size };
	}

	private isOversized(info: ImageInfo, options: PutOptions): boolean {
		if (options.maxDimension === undefined) return false;
		return exceedsDimension(info, options.maxDimension);
	}

	private changesFor(record: AssetRecord): Change[] {
		if (this.document.getEntity('asset', record.id) !== undefined) return [];
		return this.document.addEntity('asset', record);
	}

	private async registerEmbedded(ref: FontRef, bytes: Uint8Array): Promise<void> {
		const key = faceKey(ref);
		const previous = this.embeddedDisposers.get(key);
		if (previous !== undefined) await previous();
		this.embeddedDisposers.set(key, this.fonts.embed(ref, arrayBufferOf(bytes)));
	}

	private async releaseEmbedded(): Promise<void> {
		const disposers = [...this.embeddedDisposers.values()];
		this.embeddedDisposers.clear();
		for (const dispose of disposers) await dispose();
	}
}
