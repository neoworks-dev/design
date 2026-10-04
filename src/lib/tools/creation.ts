// Geometry of the click-drag creation tools (rectangle, ellipse, line, frame, ...). Pure: no
// Svelte, no kernel, no DOM. The modifier rules follow docs/research/interactions.md section 1:
//
//   Alt   draws from the centre (the press point is the middle, not a corner)
//   Shift draws a square or circle; for lines it snaps the angle to 15 degree steps
//   click without a drag creates a default sized shape with the pointer as its top left corner

import type { Matrix2x3, NodeId, Rect } from '../document/types';
import { invertMatrix, transformPoint } from '../document/matrix';
import type { Point } from './protocol';

export const DEFAULT_SHAPE_SIZE = 100;
export const LINE_SNAP_DEGREES = 15;

export interface DragModifiers {
	altKey: boolean;
	shiftKey: boolean;
}

/** The box between the press and the pointer, with Alt and Shift applied. */
export function dragBounds(start: Point, end: Point, modifiers: DragModifiers): Rect {
	let deltaX = end.x - start.x;
	let deltaY = end.y - start.y;
	if (modifiers.shiftKey) {
		const side = Math.max(Math.abs(deltaX), Math.abs(deltaY));
		deltaX = side * signOf(deltaX);
		deltaY = side * signOf(deltaY);
	}
	if (modifiers.altKey) {
		return {
			x: start.x - Math.abs(deltaX),
			y: start.y - Math.abs(deltaY),
			width: Math.abs(deltaX) * 2,
			height: Math.abs(deltaY) * 2
		};
	}
	return {
		x: Math.min(start.x, start.x + deltaX),
		y: Math.min(start.y, start.y + deltaY),
		width: Math.abs(deltaX),
		height: Math.abs(deltaY)
	};
}

function signOf(value: number): number {
	if (value < 0) return -1;
	return 1;
}

/** What a click without a drag creates: `size` square, pointer at the top left corner. */
export function clickBounds(point: Point, size: number = DEFAULT_SHAPE_SIZE): Rect {
	return { x: point.x, y: point.y, width: size, height: size };
}

export interface LineSegment {
	from: Point;
	to: Point;
}

/** The line between the press and the pointer; Shift snaps its angle, Alt draws from the middle. */
export function dragLine(start: Point, end: Point, modifiers: DragModifiers): LineSegment {
	let target = end;
	if (modifiers.shiftKey) target = snapAngle(start, end, LINE_SNAP_DEGREES);
	if (modifiers.altKey) {
		return { from: { x: 2 * start.x - target.x, y: 2 * start.y - target.y }, to: target };
	}
	return { from: start, to: target };
}

export function clickLine(point: Point, length: number = DEFAULT_SHAPE_SIZE): LineSegment {
	return { from: point, to: { x: point.x + length, y: point.y } };
}

/** `end` rotated around `start` to the nearest multiple of `stepDegrees`, same distance. */
export function snapAngle(start: Point, end: Point, stepDegrees: number): Point {
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	const distance = Math.hypot(deltaX, deltaY);
	const step = (stepDegrees * Math.PI) / 180;
	const angle = Math.round(Math.atan2(deltaY, deltaX) / step) * step;
	return { x: start.x + distance * Math.cos(angle), y: start.y + distance * Math.sin(angle) };
}

export interface LocalPlacement {
	transform: Matrix2x3;
	width: number;
	height: number;
}

/** Where `bounds` (world) sits inside a parent whose absolute transform is `parentAbsolute`. */
export function boxPlacement(bounds: Rect, parentAbsolute: Matrix2x3): LocalPlacement {
	const local = toParentSpace(parentAbsolute, { x: bounds.x, y: bounds.y });
	return {
		transform: [
			[1, 0, local.x],
			[0, 1, local.y]
		],
		width: bounds.width,
		height: bounds.height
	};
}

/** A line is a node of `length` x 0 rotated to point from `from` to `to`. */
export function linePlacement(segment: LineSegment, parentAbsolute: Matrix2x3): LocalPlacement {
	const from = toParentSpace(parentAbsolute, segment.from);
	const to = toParentSpace(parentAbsolute, segment.to);
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	return {
		transform: [
			[cosine, -sine, from.x],
			[sine, cosine, from.y]
		],
		width: Math.hypot(to.x - from.x, to.y - from.y),
		height: 0
	};
}

function toParentSpace(parentAbsolute: Matrix2x3, world: Point): Point {
	const inverse = invertMatrix(parentAbsolute);
	if (!inverse) return world;
	return transformPoint(inverse, world.x, world.y);
}

/** "Rectangle 3" when "Rectangle 1" and "Rectangle 2" exist: one past the highest number. */
export function nextName(base: string, existingNames: readonly string[]): string {
	const pattern = new RegExp(`^${escapeForRegExp(base)} (\\d+)$`);
	let highest = 0;
	for (const name of existingNames) {
		const match = pattern.exec(name);
		if (!match) continue;
		highest = Math.max(highest, Number(match[1]));
	}
	return `${base} ${highest + 1}`;
}

function escapeForRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What the nesting search needs from the document. */
export interface NestingSource {
	children(id: NodeId): readonly NodeId[];
	/** Type, visibility and lock of a node. */
	describe(id: NodeId): { frameLike: boolean; visible: boolean; locked: boolean } | undefined;
	absoluteBounds(id: NodeId): Rect;
}

/**
 * The container a shape drawn at `point` goes into: the deepest visible, unlocked frame under the
 * point (topmost sibling wins), else the page. Containment over absolute bounds; the spatial
 * index and hit testing replace this later.
 */
export function findContainer(source: NestingSource, pageId: NodeId, point: Point): NodeId {
	let container = pageId;
	let descending = true;
	while (descending) {
		descending = false;
		const siblings = source.children(container);
		for (let position = siblings.length - 1; position >= 0; position -= 1) {
			const candidate = siblings[position];
			if (!containsFrame(source, candidate, point)) continue;
			container = candidate;
			descending = true;
			break;
		}
	}
	return container;
}

function containsFrame(source: NestingSource, id: NodeId, point: Point): boolean {
	const described = source.describe(id);
	if (!described) return false;
	if (!described.frameLike || !described.visible || described.locked) return false;
	const bounds = source.absoluteBounds(id);
	if (point.x < bounds.x || point.x > bounds.x + bounds.width) return false;
	return point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}
