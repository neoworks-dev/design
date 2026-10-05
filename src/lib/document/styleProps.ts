// What a shared style says about a node (data-model.md: styles are document data, nodes refer to
// them by id, consumers read the style's value as derived data). Pure: the resolver, the styles
// service and the tests all use these two functions, so "applying a style" and "reading a styled
// node" can never disagree.

import type { Node, Paragraph, Style, StyleType, TextNode, TextStyle } from './types';

export type StyleTarget = 'fill' | 'stroke' | 'effect' | 'text' | 'grid';

interface TargetInfo {
	type: StyleType;
	/** The node property holding the style id (text keeps it inside `defaultStyle`). */
	idKey: string;
	label: string;
}

export const STYLE_TARGETS: Record<StyleTarget, TargetInfo> = {
	fill: { type: 'PAINT', idKey: 'fillStyleId', label: 'Fill' },
	stroke: { type: 'PAINT', idKey: 'strokeStyleId', label: 'Stroke' },
	effect: { type: 'EFFECT', idKey: 'effectStyleId', label: 'Effects' },
	text: { type: 'TEXT', idKey: 'textStyleId', label: 'Text' },
	grid: { type: 'GRID', idKey: 'gridStyleId', label: 'Layout grid' }
};

export const STYLE_TARGET_LIST: readonly StyleTarget[] = [
	'fill',
	'stroke',
	'effect',
	'text',
	'grid'
];

/** The text properties a text style carries (colour and links stay on the node). */
export const TEXT_STYLE_KEYS: ReadonlyArray<keyof TextStyle> = [
	'fontName',
	'fontWeight',
	'fontSize',
	'letterSpacing',
	'lineHeight',
	'textCase',
	'textDecoration'
];

/** The style id `node` has for `target`, if any. */
export function styleIdOf(node: Node, target: StyleTarget): string | undefined {
	if (target === 'text') {
		if (node.type !== 'TEXT') return undefined;
		return node.defaultStyle.textStyleId;
	}
	const value: unknown = Reflect.get(node, STYLE_TARGETS[target].idKey);
	if (typeof value !== 'string') return undefined;
	return value;
}

function pickTextStyle(value: unknown): Partial<TextStyle> {
	const picked: Partial<TextStyle> = {};
	if (typeof value !== 'object' || value === null) return picked;
	for (const key of TEXT_STYLE_KEYS) {
		if (key in value) Reflect.set(picked, key, Reflect.get(value, key));
	}
	return picked;
}

/** Runs keep only what differs from the style, so the style's values show through. */
function withoutTextStyleKeys(paragraphs: Paragraph[]): Paragraph[] {
	return paragraphs.map((paragraph) => ({
		...paragraph,
		runs: paragraph.runs.map((run) => {
			const style: Partial<TextStyle> = { ...run.style };
			for (const key of TEXT_STYLE_KEYS) delete style[key];
			return { ...run, style };
		})
	}));
}

function textProps(node: TextNode, style: Style, stripRuns: boolean): Record<string, unknown> {
	const props: Record<string, unknown> = {
		defaultStyle: { ...node.defaultStyle, ...pickTextStyle(style.value), textStyleId: style.id }
	};
	if (stripRuns) props.paragraphs = withoutTextStyleKeys(node.paragraphs);
	return props;
}

/**
 * The node properties `style` sets when applied to `node` for `target`, without the id itself.
 * Empty when the style does not fit the node (wrong type, no such property). `stripRuns` (when
 * writing, not when reading) also clears the run overrides of a text style's properties.
 */
export function styleProps(
	node: Node,
	target: StyleTarget,
	style: Style,
	stripRuns = false
): Record<string, unknown> {
	if (style.type !== STYLE_TARGETS[target].type) return {};
	if (target === 'text') {
		if (node.type !== 'TEXT') return {};
		return textProps(node, style, stripRuns);
	}
	if (!Array.isArray(style.value)) return {};
	const props: Record<string, unknown> = {};
	if (target === 'fill' && 'fills' in node) props.fills = style.value;
	if (target === 'effect' && 'effects' in node) props.effects = style.value;
	if (target === 'grid' && 'layoutGrids' in node) props.layoutGrids = style.value;
	if (target === 'stroke' && 'strokes' in node) {
		const paints = style.value;
		props.strokes = node.strokes.map((stroke) => ({ ...stroke, paints }));
	}
	return props;
}

/**
 * The node as its styles say it should look: each style id replaced by the style's current value.
 * The same object when no style applies. `lookup` also reports which styles were read.
 */
export function styledNode(node: Node, lookup: (id: string) => Style | undefined): Node {
	let overrides: Record<string, unknown> | undefined;
	for (const target of STYLE_TARGET_LIST) {
		const id = styleIdOf(node, target);
		if (id === undefined) continue;
		const style = lookup(id);
		if (style === undefined) continue;
		const props = styleProps(node, target, style);
		if (Object.keys(props).length === 0) continue;
		overrides = { ...overrides, ...props };
	}
	if (overrides === undefined) return node;
	return { ...node, ...overrides } as Node;
}

/** Every style id `node` refers to. */
export function styleIdsOf(node: Node): string[] {
	const ids: string[] = [];
	for (const target of STYLE_TARGET_LIST) {
		const id = styleIdOf(node, target);
		if (id !== undefined) ids.push(id);
	}
	return ids;
}
