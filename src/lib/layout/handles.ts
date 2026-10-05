// The padding and gap handles of a selected auto layout frame (docs/research/interactions.md
// section 4). Pure: this file finds the bands the handles sit on and turns a drag into the
// properties it writes; drawing and pointer handling are in the autolayout-handles plugin.

import type { Rect } from '../document/types';
import { splitIntoLines, type Point } from './dropIndex';
import type { PaddingSide } from './flow';

export type LayoutHandle =
	| { kind: 'padding'; side: PaddingSide; band: Rect }
	/** Between two neighbours on a line: drags `itemSpacing`. */
	| { kind: 'gap'; band: Rect }
	/** Between two lines of a wrapping frame: drags `counterAxisSpacing`. */
	| { kind: 'line-gap'; band: Rect };

export interface HandleFrame {
	/** The frame's box in page space. */
	bounds: Rect;
	mode: 'HORIZONTAL' | 'VERTICAL';
	wrap: boolean;
	spaceBetween: boolean;
	padding: Record<PaddingSide, number>;
	/** Flow children in stacking order, in page space. */
	children: readonly Rect[];
}

export function handleId(handle: LayoutHandle, position = 0): string {
	if (handle.kind === 'padding') return `padding-${handle.side}`;
	return `${handle.kind}-${position}`;
}

function paddingBands(frame: HandleFrame): LayoutHandle[] {
	const { bounds, padding } = frame;
	const innerWidth = Math.max(0, bounds.width - padding.Left - padding.Right);
	const innerHeight = Math.max(0, bounds.height - padding.Top - padding.Bottom);
	return [
		{
			kind: 'padding',
			side: 'Top',
			band: { x: bounds.x + padding.Left, y: bounds.y, width: innerWidth, height: padding.Top }
		},
		{
			kind: 'padding',
			side: 'Right',
			band: {
				x: bounds.x + bounds.width - padding.Right,
				y: bounds.y + padding.Top,
				width: padding.Right,
				height: innerHeight
			}
		},
		{
			kind: 'padding',
			side: 'Bottom',
			band: {
				x: bounds.x + padding.Left,
				y: bounds.y + bounds.height - padding.Bottom,
				width: innerWidth,
				height: padding.Bottom
			}
		},
		{
			kind: 'padding',
			side: 'Left',
			band: { x: bounds.x, y: bounds.y + padding.Top, width: padding.Left, height: innerHeight }
		}
	];
}

function gapBetween(previous: Rect, next: Rect, mode: 'HORIZONTAL' | 'VERTICAL'): Rect {
	if (mode === 'HORIZONTAL') {
		const top = Math.min(previous.y, next.y);
		const bottom = Math.max(previous.y + previous.height, next.y + next.height);
		const left = previous.x + previous.width;
		return { x: left, y: top, width: Math.max(0, next.x - left), height: bottom - top };
	}
	const left = Math.min(previous.x, next.x);
	const right = Math.max(previous.x + previous.width, next.x + next.width);
	const top = previous.y + previous.height;
	return { x: left, y: top, width: right - left, height: Math.max(0, next.y - top) };
}

function gapBands(frame: HandleFrame): LayoutHandle[] {
	if (frame.spaceBetween) return [];
	const handles: LayoutHandle[] = [];
	const lines = frame.wrap && frame.mode === 'HORIZONTAL' ? splitIntoLines(frame.children) : null;
	if (lines === null) {
		for (let index = 1; index < frame.children.length; index += 1) {
			const band = gapBetween(frame.children[index - 1], frame.children[index], frame.mode);
			handles.push({ kind: 'gap', band });
		}
		return handles;
	}
	for (const line of lines) {
		for (let index = 1; index < line.rects.length; index += 1) {
			handles.push({
				kind: 'gap',
				band: gapBetween(line.rects[index - 1], line.rects[index], 'HORIZONTAL')
			});
		}
	}
	for (let index = 1; index < lines.length; index += 1) {
		const above = lines[index - 1];
		const below = lines[index];
		const left = Math.min(...above.rects.map((rect) => rect.x));
		const right = Math.max(...above.rects.map((rect) => rect.x + rect.width));
		handles.push({
			kind: 'line-gap',
			band: {
				x: left,
				y: above.bottom,
				width: right - left,
				height: Math.max(0, below.top - above.bottom)
			}
		});
	}
	return handles;
}

/** Every handle the frame shows: four padding bands, then the gaps between its children. */
export function layoutHandles(frame: HandleFrame): LayoutHandle[] {
	return [...paddingBands(frame), ...gapBands(frame)];
}

export interface HandleStart {
	padding: Record<PaddingSide, number>;
	itemSpacing: number;
	counterSpacing: number;
}

export interface DragModifiers {
	altKey: boolean;
	shiftKey: boolean;
}

const OPPOSITE: Record<PaddingSide, PaddingSide> = {
	Top: 'Bottom',
	Bottom: 'Top',
	Left: 'Right',
	Right: 'Left'
};

const ALL_SIDES: PaddingSide[] = ['Top', 'Right', 'Bottom', 'Left'];

function whole(value: number): number {
	return Math.max(0, Math.round(value));
}

/** Dragging a padding handle inward grows the padding; Alt mirrors it, Shift sets every side. */
function paddingProps(
	side: PaddingSide,
	start: HandleStart,
	delta: Point,
	modifiers: DragModifiers
): Record<string, number> {
	const inward = { Top: delta.y, Bottom: -delta.y, Left: delta.x, Right: -delta.x }[side];
	const value = whole(start.padding[side] + inward);
	let sides: PaddingSide[] = [side];
	if (modifiers.shiftKey) sides = ALL_SIDES;
	else if (modifiers.altKey) sides = [side, OPPOSITE[side]];
	return Object.fromEntries(sides.map((target) => [`padding${target}`, value]));
}

/** The properties a handle drag of `delta` (page units since the press) writes. */
export function handleDragProps(
	handle: LayoutHandle,
	mode: 'HORIZONTAL' | 'VERTICAL',
	start: HandleStart,
	delta: Point,
	modifiers: DragModifiers
): Record<string, number> {
	if (handle.kind === 'padding') return paddingProps(handle.side, start, delta, modifiers);
	if (handle.kind === 'gap') {
		const along = mode === 'HORIZONTAL' ? delta.x : delta.y;
		return { itemSpacing: whole(start.itemSpacing + along) };
	}
	return { counterAxisSpacing: whole(start.counterSpacing + delta.y) };
}

/** The value a drag shows in its label. */
export function handleLabelValue(
	handle: LayoutHandle,
	props: Record<string, number>
): number | undefined {
	if (handle.kind === 'padding') return props[`padding${handle.side}`];
	if (handle.kind === 'gap') return props.itemSpacing;
	return props.counterAxisSpacing;
}
