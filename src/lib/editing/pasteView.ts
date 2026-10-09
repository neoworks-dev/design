// How the view reacts after a paste or duplicate (Figma's ensureSelectionContentsAreVisibleInViewport,
// measured in paste-view and paste-destination). Pure: rectangles in, an adjustment out.
//
// The safe area is the view shrunk by a sixteenth on every side. Per axis the view pans just far
// enough to bring a selection that misses the safe area to its nearest edge; it zooms to the
// selection only when the selection then covers the whole safe area.

import type { Rect, Vec2 } from '../document';

/** Which zoom rule follows the pan. */
export type ZoomRule = 'covers-safe-area' | 'larger-than-safe-area' | 'always';

/**
 * How far the view pans: `overlap` leaves content that touches the safe area where it is (paste),
 * `just-enough` brings all of it inside the safe area (duplicates that moved).
 */
export type PanMode = 'overlap' | 'just-enough';

export type ViewAdjustment =
	{ kind: 'none' } | { kind: 'pan'; shift: Vec2 } | { kind: 'zoom-to-selection' };

const SAFE_MARGIN = 1 / 16;

function safeArea(view: Rect): Rect {
	return {
		x: view.x + view.width * SAFE_MARGIN,
		y: view.y + view.height * SAFE_MARGIN,
		width: view.width * (1 - 2 * SAFE_MARGIN),
		height: view.height * (1 - 2 * SAFE_MARGIN)
	};
}

/** How far the view moves along one axis so `content` reaches the safe range; 0 when it overlaps. */
function overlapShift(
	contentStart: number,
	contentEnd: number,
	safeStart: number,
	safeEnd: number
): number {
	if (contentStart < safeEnd && safeStart < contentEnd) return 0;
	if (contentEnd <= safeStart) return contentStart - safeStart;
	return contentEnd - safeEnd;
}

/** The smallest move that brings `content` inside the safe range; the nearer edge when it is larger. */
function justEnoughShift(
	contentStart: number,
	contentEnd: number,
	safeStart: number,
	safeEnd: number
): number {
	const startsBefore = contentStart < safeStart;
	const endsAfter = contentEnd > safeEnd;
	if (!startsBefore && !endsAfter) return 0;
	if (startsBefore && !endsAfter) return contentStart - safeStart;
	if (endsAfter && !startsBefore) return contentEnd - safeEnd;
	const contentMiddle = (contentStart + contentEnd) / 2;
	if (contentMiddle < (safeStart + safeEnd) / 2) return contentStart - safeStart;
	return contentEnd - safeEnd;
}

function covers(outer: Rect, inner: Rect): boolean {
	if (outer.x > inner.x || outer.y > inner.y) return false;
	if (outer.x + outer.width < inner.x + inner.width) return false;
	return outer.y + outer.height >= inner.y + inner.height;
}

function shouldZoom(content: Rect, safe: Rect, rule: ZoomRule): boolean {
	if (rule === 'always') return true;
	if (rule === 'covers-safe-area') return covers(content, safe);
	return content.width > safe.width || content.height > safe.height;
}

export function planViewAdjustment(
	content: Rect,
	view: Rect,
	rule: ZoomRule,
	panMode: PanMode = 'overlap'
): ViewAdjustment {
	if (rule === 'always') return { kind: 'zoom-to-selection' };
	const safe = safeArea(view);
	const axisShift = panMode === 'overlap' ? overlapShift : justEnoughShift;
	const shift = {
		x: axisShift(content.x, content.x + content.width, safe.x, safe.x + safe.width),
		y: axisShift(content.y, content.y + content.height, safe.y, safe.y + safe.height)
	};
	const movedSafe = { ...safe, x: safe.x + shift.x, y: safe.y + shift.y };
	if (shouldZoom(content, movedSafe, rule)) return { kind: 'zoom-to-selection' };
	if (shift.x === 0 && shift.y === 0) return { kind: 'none' };
	return { kind: 'pan', shift };
}
