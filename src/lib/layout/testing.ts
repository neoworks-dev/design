// Builders for engine tests (not shipped).

import { computeLayout } from './engine';
import type {
	ContainerSettings,
	LayoutContainer,
	LayoutItem,
	LayoutItemBase,
	LayoutLeaf,
	Size
} from './types';
import { NO_INSETS } from './types';

export function itemBase(id: string, width: number, height: number): LayoutItemBase {
	return {
		id,
		x: 0,
		y: 0,
		width,
		height,
		minWidth: null,
		maxWidth: null,
		minHeight: null,
		maxHeight: null,
		sizingHorizontal: 'FIXED',
		sizingVertical: 'FIXED',
		positioning: 'AUTO',
		strokeInsets: NO_INSETS
	};
}

export function leaf(
	id: string,
	width: number,
	height: number,
	overrides: Partial<LayoutLeaf> = {}
): LayoutLeaf {
	return { ...itemBase(id, width, height), kind: 'leaf', ...overrides };
}

export function stackSettings(overrides: Partial<ContainerSettings> = {}): ContainerSettings {
	return {
		mode: 'HORIZONTAL',
		wrap: false,
		primaryAlign: 'MIN',
		counterAlign: 'MIN',
		counterContentAlign: 'AUTO',
		itemSpacing: 0,
		counterSpacing: null,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		...overrides
	};
}

export function stack(
	id: string,
	size: Size,
	settings: Partial<ContainerSettings>,
	children: LayoutItem[],
	overrides: Partial<LayoutContainer> = {}
): LayoutContainer {
	return {
		...itemBase(id, size.width, size.height),
		kind: 'container',
		settings: stackSettings(settings),
		children,
		...overrides
	};
}

/** Text stand-in: each character is `charWidth` wide, lines are `lineHeight` tall, no hyphenation. */
export function fakeText(
	text: string,
	charWidth = 10,
	lineHeight = 20
): (width: number | null) => Size {
	return (width) => {
		const natural = text.length * charWidth;
		if (width === null || natural <= width) return { width: natural, height: lineHeight };
		const perLine = Math.max(1, Math.floor(width / charWidth));
		return { width, height: Math.ceil(text.length / perLine) * lineHeight };
	};
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** `{ id: { x, y, width, height } }` of the layout of `root`. */
export function boxes(root: LayoutContainer): Record<string, Box> {
	const result: Record<string, Box> = {};
	for (const [id, value] of computeLayout(root)) {
		result[id] = { x: value.x, y: value.y, width: value.width, height: value.height };
	}
	return result;
}
