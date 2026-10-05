// Which part of a document its home-screen preview shows, and at what size. Pure helpers over the
// document reader so they can be tested; drawing is the headless renderer's job.

import type { NodeId } from '../document';

/** Longest side of a stored preview, in pixels. */
export const THUMBNAIL_MAX_SIDE = 480;

interface ThumbnailSource {
	/** Children of the current page, bottom to top. */
	topLevel(): readonly { id: NodeId; type: string; width: number; height: number }[];
}

/**
 * The first top-level frame (or section) of the current page, else the first node: the thing a
 * person would call "the design". Empty pages have none.
 */
export function pickThumbnailNode(source: ThumbnailSource): NodeId | undefined {
	const candidates = source.topLevel().filter((node) => node.width > 0 && node.height > 0);
	const frame = candidates.find((node) => node.type === 'FRAME' || node.type === 'SECTION');
	if (frame !== undefined) return frame.id;
	if (candidates.length > 0) return candidates[0].id;
	return undefined;
}

/** The export scale that fits the larger side in `THUMBNAIL_MAX_SIDE` (never magnifies). */
export function thumbnailScale(width: number, height: number): number {
	const longest = Math.max(width, height);
	if (longest <= 0) return 1;
	return Math.min(1, THUMBNAIL_MAX_SIDE / longest);
}
