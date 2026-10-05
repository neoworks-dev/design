// Hand-written measurement snapshots for the converter and serializer tests.

import type { RGBA } from '../../document';
import type { HtmlMeasurer } from '../../services/htmlLayout';
import { parseRgbFunction } from './cssValues';
import type { ElementSnapshot, FontSnapshot, StyleSnapshot, TextSnapshot } from './snapshot';

export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

export function font(overrides: Partial<FontSnapshot> = {}): FontSnapshot {
	return {
		family: 'Geist',
		available: true,
		weight: 400,
		italic: false,
		size: 16,
		lineHeight: null,
		letterSpacing: 0,
		transform: 'none',
		decoration: 'none',
		color: BLACK,
		...overrides
	};
}

export const NO_SIDES = { top: 0, right: 0, bottom: 0, left: 0 };

export function style(overrides: Partial<StyleSnapshot> = {}): StyleSnapshot {
	return {
		display: 'block',
		position: 'static',
		visible: true,
		opacity: 1,
		blendMode: 'normal',
		clips: false,
		flexDirection: 'row',
		flexWrap: 'nowrap',
		flexGrow: 0,
		justifyContent: 'normal',
		alignItems: 'normal',
		alignSelf: 'auto',
		rowGap: 0,
		columnGap: 0,
		padding: NO_SIDES,
		margin: NO_SIDES,
		borderWidth: NO_SIDES,
		borderStyle: 'none',
		borderColor: null,
		radii: [0, 0, 0, 0],
		background: null,
		backgroundLayers: [],
		shadows: [],
		blur: 0,
		backdropBlur: 0,
		minWidth: null,
		maxWidth: null,
		minHeight: null,
		maxHeight: null,
		textAlign: 'start',
		whiteSpace: 'normal',
		font: font(),
		...overrides
	};
}

export function element(
	box: [number, number, number, number],
	overrides: Partial<Omit<ElementSnapshot, 'style'>> & { style?: Partial<StyleSnapshot> } = {}
): ElementSnapshot {
	const { style: styleOverrides, ...rest } = overrides;
	return {
		kind: 'element',
		tag: 'div',
		attributes: {},
		box: { x: box[0], y: box[1], width: box[2], height: box[3] },
		style: style(styleOverrides),
		sizing: { width: 'fixed', height: 'fixed' },
		variables: {},
		children: [],
		...rest
	};
}

export function text(
	content: string,
	box: [number, number, number, number],
	lines = 1
): TextSnapshot {
	return {
		box: { x: box[0], y: box[1], width: box[2], height: box[3] },
		lines,
		paragraphs: [[{ text: content, font: font() }]]
	};
}

function pixelsOf(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	if (Number.isNaN(parsed)) return fallback;
	return parsed;
}

function colorOf(value: string): RGBA | null {
	const trimmed = value.trim();
	if (trimmed === '') return null;
	const rgb = parseRgbFunction(trimmed);
	if (rgb !== null) return rgb;
	const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
	if (hex === null) return null;
	const channel = (offset: number): number =>
		Number.parseInt(hex[1].slice(offset, offset + 2), 16) / 255;
	return { r: channel(0), g: channel(2), b: channel(4), a: 1 };
}

function staticElement(source: Element, parentX: number, parentY: number): ElementSnapshot {
	const inline = source.getAttribute('style') ?? '';
	const declarations = new Map<string, string>();
	for (const declaration of inline.split(';')) {
		const [key, ...rest] = declaration.split(':');
		if (key.trim() !== '') declarations.set(key.trim(), rest.join(':').trim());
	}
	const read = (key: string): string => declarations.get(key) ?? '';
	const x = parentX + pixelsOf(read('left'), 0);
	const y = parentY + pixelsOf(read('top'), 0);
	const attributes: Record<string, string> = {};
	for (const name of ['data-id', 'data-name', 'data-component']) {
		const value = source.getAttribute(name);
		if (value !== null) attributes[name] = value;
	}
	const children = Array.from(source.children).map((child) => staticElement(child, x, y));
	const snapshot = element([x, y, pixelsOf(read('width'), 100), pixelsOf(read('height'), 20)], {
		tag: source.tagName.toLowerCase(),
		attributes,
		style: { background: colorOf(read('background')), position: 'absolute' },
		children
	});
	const characters = source.textContent ?? '';
	if (children.length === 0 && characters.trim() !== '') {
		snapshot.text = text(characters.trim(), [x, y, snapshot.box.width, snapshot.box.height]);
	}
	return snapshot;
}

/**
 * A stand-in for the browser layout in tests (happy-dom lays nothing out): every element sits at
 * its inline `left`/`top` inside its parent, sized by its inline `width`/`height`.
 */
export const staticLayout: HtmlMeasurer = {
	measure: (html) => {
		const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
		const roots = Array.from(parsed.body.children).map((child) => staticElement(child, 0, 0));
		return Promise.resolve({ roots, warnings: [], hiddenIds: [] });
	}
};
