// Missing-font fallback: from the `{ family, style }` a document references to a face that can be
// drawn, plus a `missing` flag. Substitution is a draw-time decision and is never written back to
// the document (docs/design/data-model.md, Text).

import type { FontRef } from '../../../electron/bridge';
import { styleDistance } from './style';

export type { FontRef };

export type FontSource = 'embedded' | 'system' | 'bundled';

/** A face the app can draw with. */
export interface FontEntry extends FontRef {
	source: FontSource;
}

export interface ResolvedFont {
	/** The face to draw with; equals the reference when nothing is missing. */
	face: FontEntry;
	/** True when `face` is a substitute because the referenced face is not available. */
	missing: boolean;
}

const SOURCE_PRIORITY: Record<FontSource, number> = { embedded: 0, system: 1, bundled: 2 };

export function sameFamily(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function sameFace(left: FontRef, right: FontRef): boolean {
	return sameFamily(left.family, right.family) && sameFamily(left.style, right.style);
}

function bySource(left: FontEntry, right: FontEntry): number {
	return SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source];
}

/** The candidate whose style is nearest to `style`; ties go to the more preferred source. */
function nearest(style: string, candidates: readonly FontEntry[]): FontEntry | undefined {
	let best: FontEntry | undefined;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const distance = styleDistance(style, candidate.style);
		if (
			distance < bestDistance ||
			(distance === bestDistance && best && bySource(candidate, best) < 0)
		) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * Resolve `ref` against the available `faces`:
 *
 * 1. the exact family and style (names compare case-insensitively): `missing: false`;
 * 2. the same family in the nearest style (weight, then slant): `missing: true`;
 * 3. otherwise the nearest style of the `fallback` faces (the bundled font): `missing: true`.
 *
 * Never throws for an unknown font; `fallback` must not be empty.
 */
export function resolveFont(
	ref: FontRef,
	faces: readonly FontEntry[],
	fallback: readonly FontEntry[]
): ResolvedFont {
	const sameFamilyFaces = faces.filter((face) => sameFamily(face.family, ref.family));
	const exact = sameFamilyFaces
		.filter((face) => sameFamily(face.style, ref.style))
		.sort(bySource)[0];
	if (exact) return { face: exact, missing: false };

	const sibling = nearest(ref.style, sameFamilyFaces);
	if (sibling) return { face: sibling, missing: true };

	const substitute = nearest(ref.style, fallback);
	if (!substitute) throw new Error('resolveFont needs at least one fallback face');
	return { face: substitute, missing: true };
}
