// The properties a model may set, in the vocabulary it knows from Figma (`x`, `y`, `fill: '#fff'`,
// `characters`, `padding`), translated to document node properties. Anything else is refused with
// the list of what is supported, so a typo never silently does nothing.

import {
	emptyParagraph,
	type Matrix2x3,
	type Node,
	type Paint,
	type Paragraph,
	type Stroke,
	type TextStyle
} from '../../document';
import { hexToRgb } from './color';

/** Properties that map one to one onto the node. */
const DIRECT_PROPERTIES = [
	'name',
	'visible',
	'locked',
	'opacity',
	'width',
	'height',
	'cornerRadius',
	'constrainProportions',
	'clipsContent',
	'blendMode',
	'layoutMode',
	'layoutWrap',
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'layoutPositioning',
	'textAlignVertical'
];

const TRANSLATED_PROPERTIES = [
	'x',
	'y',
	'rotation',
	'fill',
	'fills',
	'stroke',
	'strokeWeight',
	'padding',
	'characters',
	'fontSize',
	'fontName',
	'textColor'
];

export const SETTABLE_PROPERTIES = [...DIRECT_PROPERTIES, ...TRANSLATED_PROPERTIES];

/** What one fill may be: a hex string, or `{ color, opacity? }`. */
export type FillInput = string | { color: string; opacity?: number };

export type PropsInput = Record<string, unknown>;

function solidPaint(input: FillInput): Paint {
	if (typeof input === 'string') {
		return {
			type: 'SOLID',
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL',
			color: hexToRgb(input)
		};
	}
	return {
		type: 'SOLID',
		visible: true,
		opacity: input.opacity === undefined ? 1 : input.opacity,
		blendMode: 'NORMAL',
		color: hexToRgb(input.color)
	};
}

function fillInputOf(value: unknown, property: string): FillInput {
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value !== null) {
		const color = Reflect.get(value, 'color');
		const opacity = Reflect.get(value, 'opacity');
		if (typeof color === 'string' && (opacity === undefined || typeof opacity === 'number')) {
			return opacity === undefined ? { color } : { color, opacity };
		}
	}
	throw new Error(`${property} must be a hex color or { color, opacity }`);
}

function fillsOf(value: unknown): Paint[] {
	if (!Array.isArray(value)) throw new Error('fills must be an array of hex colors');
	return value.map((entry) => solidPaint(fillInputOf(entry, 'fills')));
}

function numberOf(value: unknown, property: string): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	throw new Error(`${property} must be a number`);
}

function strokeOf(color: unknown, weight: unknown): Stroke {
	return {
		paints: [solidPaint(fillInputOf(color, 'stroke'))],
		weight: weight === undefined ? 1 : numberOf(weight, 'strokeWeight'),
		align: 'INSIDE',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

function withTranslation(transform: Matrix2x3, x?: number, y?: number): Matrix2x3 {
	return [
		[transform[0][0], transform[0][1], x === undefined ? transform[0][2] : x],
		[transform[1][0], transform[1][1], y === undefined ? transform[1][2] : y]
	];
}

function rotated(transform: Matrix2x3, degrees: number): Matrix2x3 {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return [
		[cosine, -sine, transform[0][2]],
		[sine, cosine, transform[1][2]]
	];
}

function transformOf(props: PropsInput, base: Matrix2x3): Matrix2x3 | null {
	const hasX = props.x !== undefined;
	const hasY = props.y !== undefined;
	const hasRotation = props.rotation !== undefined;
	if (!hasX && !hasY && !hasRotation) return null;
	let transform = base;
	if (hasRotation) transform = rotated(transform, numberOf(props.rotation, 'rotation'));
	return withTranslation(
		transform,
		hasX ? numberOf(props.x, 'x') : undefined,
		hasY ? numberOf(props.y, 'y') : undefined
	);
}

function textProps(props: PropsInput, node: Node | null): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const current = node !== null && node.type === 'TEXT' ? node.defaultStyle : null;
	const style: Partial<TextStyle> = {};
	if (props.fontSize !== undefined) style.fontSize = numberOf(props.fontSize, 'fontSize');
	if (props.fontName !== undefined) style.fontName = fontNameOf(props.fontName);
	if (props.textColor !== undefined) {
		style.fills = [solidPaint(fillInputOf(props.textColor, 'textColor'))];
	}
	if (Object.keys(style).length > 0 && current !== null) {
		result.defaultStyle = { ...current, ...style };
	}
	if (props.characters !== undefined) {
		if (typeof props.characters !== 'string') throw new Error('characters must be a string');
		const lines = props.characters.split('\n');
		result.paragraphs = lines.map(paragraphOf);
	}
	return result;
}

function fontNameOf(value: unknown): TextStyle['fontName'] {
	if (typeof value === 'object' && value !== null) {
		const family = Reflect.get(value, 'family');
		const style = Reflect.get(value, 'style');
		if (typeof family === 'string' && typeof style === 'string') return { family, style };
	}
	throw new Error('fontName must be { family, style }');
}

function paragraphOf(line: string): Paragraph {
	const paragraph = emptyParagraph();
	if (line !== '') paragraph.runs = [{ text: line, style: {} }];
	return paragraph;
}

function paddingProps(value: unknown): Record<string, number> {
	const amount = numberOf(value, 'padding');
	return { paddingTop: amount, paddingRight: amount, paddingBottom: amount, paddingLeft: amount };
}

function rejectUnknown(props: PropsInput): void {
	const unknown = Object.keys(props).filter((key) => !SETTABLE_PROPERTIES.includes(key));
	if (unknown.length === 0) return;
	throw new Error(
		`unknown propert${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}. ` +
			`Supported: ${SETTABLE_PROPERTIES.join(', ')}`
	);
}

/**
 * Node properties for `props`. `base` is the node as it is now (for a set) or the defaults of the
 * new node (for a create): translation and text styles merge into it.
 */
export function translateProps(props: PropsInput, base: Node): Record<string, unknown> {
	rejectUnknown(props);
	const result: Record<string, unknown> = {};
	for (const key of DIRECT_PROPERTIES) {
		if (props[key] !== undefined) result[key] = props[key];
	}
	if (props.padding !== undefined) Object.assign(result, paddingProps(props.padding));
	if (props.fill !== undefined) result.fills = [solidPaint(fillInputOf(props.fill, 'fill'))];
	if (props.fills !== undefined) result.fills = fillsOf(props.fills);
	if (props.stroke === null) result.strokes = [];
	if (props.stroke !== undefined && props.stroke !== null) {
		result.strokes = [strokeOf(props.stroke, props.strokeWeight)];
	}
	if (props.stroke === undefined && props.strokeWeight !== undefined) {
		throw new Error('strokeWeight needs a stroke color');
	}
	if (base.type !== 'PAGE') {
		const transform = transformOf(props, base.transform);
		if (transform !== null) result.transform = transform;
	}
	Object.assign(result, textProps(props, base));
	return result;
}
