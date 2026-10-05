// Guides of a page, pure (#72). The document stores them on their owner: the page (offset in page
// coordinates) or a frame (offset from the frame's origin), see `Guide` in lib/document/types.ts.
// Axis 'X' is a vertical line at x = offset, axis 'Y' a horizontal line at y = offset. A guide made
// inside a frame belongs to that frame and moves with it.

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type Guide,
	type Node,
	type NodeId
} from '../document';

export interface PlacedGuide {
	ownerId: NodeId;
	/** Position in the owner's `guides` array. */
	index: number;
	axis: Guide['axis'];
	/** Page coordinate of the line. */
	position: number;
	/** Range on the other axis a frame's guide reaches; the whole canvas for a page guide. */
	span?: { start: number; end: number };
}

export interface GuideRef {
	ownerId: NodeId;
	index: number;
}

function guidesOf(node: Node): Guide[] | undefined {
	if (node.type === 'PAGE') return node.guides;
	if ('guides' in node) return node.guides;
	return undefined;
}

function originOf(reader: DocumentReader, ownerId: NodeId): { x: number; y: number } {
	const node = reader.requireNode(ownerId);
	if (node.type === 'PAGE') return { x: 0, y: 0 };
	const [[, , x], [, , y]] = reader.cache.absoluteTransform(ownerId);
	return { x, y };
}

function placeGuide(reader: DocumentReader, owner: Node, guide: Guide, index: number): PlacedGuide {
	if (owner.type === 'PAGE') {
		return { ownerId: owner.id, index, axis: guide.axis, position: guide.offset };
	}
	const origin = originOf(reader, owner.id);
	const bounds = reader.cache.absoluteBounds(owner.id);
	if (guide.axis === 'X') {
		return {
			ownerId: owner.id,
			index,
			axis: 'X',
			position: origin.x + guide.offset,
			span: { start: bounds.y, end: bounds.y + bounds.height }
		};
	}
	return {
		ownerId: owner.id,
		index,
		axis: 'Y',
		position: origin.y + guide.offset,
		span: { start: bounds.x, end: bounds.x + bounds.width }
	};
}

/** Every guide on the page and on the frames below it, with page coordinates. */
export function placedGuides(reader: DocumentReader, pageId: NodeId): PlacedGuide[] {
	const placed: PlacedGuide[] = [];
	for (const node of [reader.requireNode(pageId), ...reader.descendants(pageId)]) {
		const guides = guidesOf(node);
		if (guides === undefined) continue;
		guides.forEach((guide, index) => placed.push(placeGuide(reader, node, guide, index)));
	}
	return placed;
}

/** The top-level frame under `point` (the topmost when they overlap), or the page. */
export function guideOwnerAt(
	reader: DocumentReader,
	pageId: NodeId,
	point: { x: number; y: number }
): NodeId {
	let owner = pageId;
	for (const node of reader.childNodes(pageId)) {
		if (node.type !== 'FRAME' || !node.visible) continue;
		const bounds = reader.cache.absoluteBounds(node.id);
		const inside =
			point.x >= bounds.x &&
			point.x <= bounds.x + bounds.width &&
			point.y >= bounds.y &&
			point.y <= bounds.y + bounds.height;
		if (inside) owner = node.id;
	}
	return owner;
}

function ownerGuides(reader: DocumentReader, ownerId: NodeId): Guide[] {
	const guides = guidesOf(reader.requireNode(ownerId));
	if (guides === undefined) return [];
	return guides;
}

function offsetFor(
	reader: DocumentReader,
	ownerId: NodeId,
	axis: Guide['axis'],
	position: number
): number {
	const origin = originOf(reader, ownerId);
	if (axis === 'X') return position - origin.x;
	return position - origin.y;
}

export function planAddGuide(
	reader: DocumentReader,
	ownerId: NodeId,
	axis: Guide['axis'],
	position: number
): Change[] {
	const offset = offsetFor(reader, ownerId, axis, position);
	return planSetProps(reader, ownerId, {
		guides: [...ownerGuides(reader, ownerId), { axis, offset }]
	});
}

export function planMoveGuide(reader: DocumentReader, ref: GuideRef, position: number): Change[] {
	const guides = ownerGuides(reader, ref.ownerId);
	const guide = guides[ref.index];
	if (guide === undefined) return [];
	const offset = offsetFor(reader, ref.ownerId, guide.axis, position);
	const next = guides.map((entry, index) => (index === ref.index ? { ...entry, offset } : entry));
	return planSetProps(reader, ref.ownerId, { guides: next });
}

export function planRemoveGuide(reader: DocumentReader, ref: GuideRef): Change[] {
	const guides = ownerGuides(reader, ref.ownerId);
	return planSetProps(reader, ref.ownerId, {
		guides: guides.filter((_, index) => index !== ref.index)
	});
}
