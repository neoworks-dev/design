// SVG gradients to gradient paints (#106). A gradient paint stores a transform from the node's
// normalised box to gradient space (see src/lib/renderer/draw/paintShaders.ts: a linear gradient
// runs (0, 0.5) to (1, 0.5), a radial one is centred (0.5, 0.5) with radius 0.5), so each SVG
// gradient is turned into the matrix that carries gradient space into the node's box and then
// inverted.

import { composeMatrices, invertMatrix } from '../document/matrix';
import type { ColorStop, GradientPaint, Matrix2x3, Rect } from '../document/types';
import { parseColor } from './color';
import { tagName } from './dom';
import { computedStyle, ownStyle, type CssRule } from './styles';
import { parseTransform } from './transform';

export interface GradientContext {
	/** Elements by id. */
	elements: ReadonlyMap<string, Element>;
	rules: readonly CssRule[];
	/** Size of the viewport, for percentages in user space gradients. */
	viewport: { width: number; height: number };
	warn: (message: string) => void;
}

const MAX_HREF_DEPTH = 8;

function chain(start: Element, context: GradientContext): Element[] {
	const elements = [start];
	let current = start;
	while (elements.length < MAX_HREF_DEPTH) {
		const href = current.getAttribute('href') ?? current.getAttribute('xlink:href');
		if (href === null || !href.startsWith('#')) break;
		const next = context.elements.get(href.slice(1));
		if (!next || elements.includes(next)) break;
		elements.push(next);
		current = next;
	}
	return elements;
}

function attributeOf(elements: readonly Element[], name: string): string | null {
	for (const element of elements) {
		const value = element.getAttribute(name);
		if (value !== null) return value;
	}
	return null;
}

function stopsOf(elements: readonly Element[], context: GradientContext): ColorStop[] {
	const owner = elements.find((element) =>
		Array.from(element.children).some((child) => tagName(child) === 'stop')
	);
	if (!owner) return [];
	const stops: ColorStop[] = [];
	let last = 0;
	for (const child of Array.from(owner.children)) {
		if (tagName(child) !== 'stop') continue;
		const style = computedStyle({}, ownStyle(child, context.rules));
		const color = parseColor(style['stop-color'] ?? 'black') ?? { r: 0, g: 0, b: 0, a: 1 };
		const opacity = Number.parseFloat(style['stop-opacity'] ?? '1');
		const offset = fraction(child.getAttribute('offset') ?? '0');
		last = Math.max(last, Math.min(1, Math.max(0, offset)));
		stops.push({
			position: last,
			color: { ...color, a: color.a * (Number.isFinite(opacity) ? opacity : 1) }
		});
	}
	return stops;
}

/** "50%" and "0.5" are both one half. */
function fraction(value: string): number {
	const number = Number.parseFloat(value);
	if (!Number.isFinite(number)) return 0;
	if (value.trim().endsWith('%')) return number / 100;
	return number;
}

/** A coordinate: a fraction of the box for bounding box units, user units otherwise. */
function coordinate(
	value: string | null,
	fallback: string,
	units: 'box' | 'user',
	extent: number
): number {
	const text = value === null ? fallback : value;
	if (units === 'box') return fraction(text);
	const number = Number.parseFloat(text);
	if (!Number.isFinite(number)) return 0;
	if (text.trim().endsWith('%')) return (number / 100) * extent;
	return number;
}

export function linearMatrix(from: [number, number], to: [number, number]): Matrix2x3 {
	const vectorX = to[0] - from[0];
	const vectorY = to[1] - from[1];
	return [
		[vectorX, -vectorY, from[0] + 0.5 * vectorY],
		[vectorY, vectorX, from[1] - 0.5 * vectorX]
	];
}

export function radialMatrix(centerX: number, centerY: number, radius: number): Matrix2x3 {
	return [
		[2 * radius, 0, centerX - radius],
		[0, 2 * radius, centerY - radius]
	];
}

/**
 * The paint for the gradient element `definition` on a shape whose box (in the user space the
 * gradient is used in) is `box`. Null when the gradient cannot be drawn.
 */
export function gradientPaint(
	definition: Element,
	box: Rect,
	opacity: number,
	context: GradientContext
): GradientPaint | null {
	const elements = chain(definition, context);
	const stops = stopsOf(elements, context);
	if (stops.length === 0 || box.width <= 0 || box.height <= 0) return null;
	const spread = attributeOf(elements, 'spreadMethod');
	if (spread !== null && spread !== 'pad') context.warn(`gradient spreadMethod ${spread} ignored`);
	const units = attributeOf(elements, 'gradientUnits') === 'userSpaceOnUse' ? 'user' : 'box';
	const extentX = context.viewport.width;
	const extentY = context.viewport.height;
	const radial = tagName(definition) === 'radialgradient';
	let gradientToUnits: Matrix2x3;
	if (radial) {
		const centerX = coordinate(attributeOf(elements, 'cx'), '50%', units, extentX);
		const centerY = coordinate(attributeOf(elements, 'cy'), '50%', units, extentY);
		const radius = coordinate(
			attributeOf(elements, 'r'),
			'50%',
			units,
			Math.hypot(extentX, extentY)
		);
		gradientToUnits = radialMatrix(centerX, centerY, radius);
	} else {
		gradientToUnits = linearMatrix(
			[
				coordinate(attributeOf(elements, 'x1'), '0%', units, extentX),
				coordinate(attributeOf(elements, 'y1'), '0%', units, extentY)
			],
			[
				coordinate(attributeOf(elements, 'x2'), '100%', units, extentX),
				coordinate(attributeOf(elements, 'y2'), '0%', units, extentY)
			]
		);
	}
	const attributeTransform = parseTransform(attributeOf(elements, 'gradientTransform'));
	let gradientToBox = composeMatrices(attributeTransform, gradientToUnits);
	if (units === 'user') {
		const normalise: Matrix2x3 = [
			[1 / box.width, 0, -box.x / box.width],
			[0, 1 / box.height, -box.y / box.height]
		];
		gradientToBox = composeMatrices(normalise, gradientToBox);
	}
	const boxToGradient = invertMatrix(gradientToBox);
	if (boxToGradient === null) return null;
	return {
		type: radial ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
		visible: true,
		opacity,
		blendMode: 'NORMAL',
		gradientTransform: boxToGradient,
		gradientStops: stops
	};
}
