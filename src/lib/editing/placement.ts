// Placement arithmetic shared by paste and duplicate, measured against Figma (see "Measured" in
// docs/research/figma-client/paste.md). Pure: rectangles in, rectangles out.

import type { DocumentReader, NodeId, Rect, Vec2 } from '../document';

/** Space between a copy and the node it was pushed past. */
export const NEXT_TO_GAP = 40;

/** Figma rounds placement offsets to whole pixels, halves away from zero. */
export function roundAwayFromZero(value: number): number {
	if (value < 0) return -Math.round(-value);
	return Math.round(value);
}

/** Strict overlap: rectangles that only touch do not intersect. */
export function rectsIntersect(left: Rect, right: Rect): boolean {
	if (left.width < 0 || left.height < 0 || right.width < 0 || right.height < 0) return false;
	if (left.x >= right.x + right.width || right.x >= left.x + left.width) return false;
	return left.y < right.y + right.height && right.y < left.y + left.height;
}

export function intersection(left: Rect, right: Rect): Rect | null {
	if (!rectsIntersect(left, right)) return null;
	const x = Math.max(left.x, right.x);
	const y = Math.max(left.y, right.y);
	return {
		x,
		y,
		width: Math.min(left.x + left.width, right.x + right.width) - x,
		height: Math.min(left.y + left.height, right.y + right.height) - y
	};
}

export function centreOf(rect: Rect): Vec2 {
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The whole-pixel shift that puts the centre of `content` on the centre of `area`. */
export function centringShift(area: Rect, content: Rect): Vec2 {
	const areaCentre = centreOf(area);
	const contentCentre = centreOf(content);
	return {
		x: roundAwayFromZero(areaCentre.x - contentCentre.x),
		y: roundAwayFromZero(areaCentre.y - contentCentre.y)
	};
}

/** `target` moved to the whole-pixel offset from `from`: `from + round(target - from)`. */
export function roundedFrom(from: Vec2, target: Vec2): Vec2 {
	return {
		x: from.x + roundAwayFromZero(target.x - from.x),
		y: from.y + roundAwayFromZero(target.y - from.y)
	};
}

export function translatedRect(rect: Rect, shift: Vec2): Rect {
	return { ...rect, x: rect.x + shift.x, y: rect.y + shift.y };
}

function isVisibleNode(reader: DocumentReader, id: NodeId): boolean {
	return Reflect.get(reader.requireNode(id), 'visible') !== false;
}

/** The topmost visible child of `parentId` whose bounds overlap `rect`. */
function topmostCollision(reader: DocumentReader, parentId: NodeId, rect: Rect): Rect | null {
	const siblings = reader.childNodes(parentId);
	for (let position = siblings.length - 1; position >= 0; position -= 1) {
		const sibling = siblings[position];
		if (!isVisibleNode(reader, sibling.id)) continue;
		const bounds = reader.cache.absoluteBounds(sibling.id);
		if (rectsIntersect(bounds, rect)) return bounds;
	}
	return null;
}

/**
 * Figma's "move to a free spot": while the rectangle overlaps a child of `parentId`, move it to
 * that child's right edge plus the gap. The y position never changes by the push; the result is
 * rounded to whole pixels, so a rotated node's bounding box lands on integer coordinates.
 */
export function pushRightOfSiblings(reader: DocumentReader, parentId: NodeId, start: Rect): Rect {
	let rect = start;
	let hit = topmostCollision(reader, parentId, rect);
	while (hit !== null) {
		rect = { ...rect, x: hit.x + hit.width + NEXT_TO_GAP };
		hit = topmostCollision(reader, parentId, rect);
	}
	return { ...rect, x: roundAwayFromZero(rect.x), y: roundAwayFromZero(rect.y) };
}
