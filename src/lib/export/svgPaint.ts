// Paints, strokes and effects as SVG markup (#127). Pure string building; `SvgDefs` collects the
// `<defs>` content (gradients, clip paths, masks, filters) and hands out unique ids.

import { composeMatrices, invertMatrix } from '../document/matrix';
import type { PathCommand } from '../document/outline';
import type {
	BlendMode,
	Effect,
	GradientPaint,
	Matrix2x3,
	Paint,
	RGB,
	ShadowEffect,
	Stroke
} from '../document/types';

export function formatNumber(value: number): string {
	const rounded = Math.round(value * 10000) / 10000;
	if (Object.is(rounded, -0)) return '0';
	return String(rounded);
}

export function escapeXml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

export function matrixAttribute(matrix: Matrix2x3): string {
	const [[a, c, e], [b, d, f]] = matrix;
	return `matrix(${[a, b, c, d, e, f].map(formatNumber).join(' ')})`;
}

export function isIdentity(matrix: Matrix2x3): boolean {
	const [[a, c, e], [b, d, f]] = matrix;
	return a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0;
}

function hex(channel: number): string {
	const value = Math.round(Math.min(1, Math.max(0, channel)) * 255);
	return value.toString(16).padStart(2, '0');
}

export function colorHex(color: RGB): string {
	return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** SVG path data of document path commands; arcs keep their sweep. */
export function pathData(commands: readonly PathCommand[]): string {
	const parts: string[] = [];
	for (const command of commands) {
		if (command.op === 'move') parts.push(`M${formatNumber(command.x)} ${formatNumber(command.y)}`);
		if (command.op === 'line') parts.push(`L${formatNumber(command.x)} ${formatNumber(command.y)}`);
		if (command.op === 'close') parts.push('Z');
		if (command.op === 'cubic') {
			const values = [command.x1, command.y1, command.x2, command.y2, command.x, command.y];
			parts.push(`C${values.map(formatNumber).join(' ')}`);
		}
		if (command.op === 'arc') {
			let sweep = 0;
			if (command.clockwise) sweep = 1;
			parts.push(
				`A${formatNumber(command.radiusX)} ${formatNumber(command.radiusY)} 0 0 ${sweep} ${formatNumber(command.x)} ${formatNumber(command.y)}`
			);
		}
	}
	return parts.join('');
}

const MIX_BLEND_MODES: Partial<Record<BlendMode, string>> = {
	DARKEN: 'darken',
	MULTIPLY: 'multiply',
	COLOR_BURN: 'color-burn',
	LIGHTEN: 'lighten',
	SCREEN: 'screen',
	COLOR_DODGE: 'color-dodge',
	LINEAR_DODGE: 'plus-lighter',
	OVERLAY: 'overlay',
	SOFT_LIGHT: 'soft-light',
	HARD_LIGHT: 'hard-light',
	DIFFERENCE: 'difference',
	EXCLUSION: 'exclusion',
	HUE: 'hue',
	SATURATION: 'saturation',
	COLOR: 'color',
	LUMINOSITY: 'luminosity'
};

/** The CSS `mix-blend-mode` of a blend mode, or `null` for the normal ones. */
export function cssBlendMode(mode: BlendMode): string | null {
	const found = MIX_BLEND_MODES[mode];
	if (found === undefined) return null;
	return found;
}

export class SvgDefs {
	private readonly entries: string[] = [];
	private counter = 0;
	readonly warnings = new Set<string>();

	nextId(prefix: string): string {
		this.counter += 1;
		return `${prefix}${this.counter}`;
	}

	add(markup: string): void {
		this.entries.push(markup);
	}

	markup(): string {
		if (this.entries.length === 0) return '';
		return `<defs>${this.entries.join('')}</defs>`;
	}
}

interface Size {
	width: number;
	height: number;
}

function gradientMatrix(paint: GradientPaint, size: Size): Matrix2x3 | null {
	const inverse = invertMatrix(paint.gradientTransform);
	if (inverse === null) return null;
	return composeMatrices(
		[
			[size.width, 0, 0],
			[0, size.height, 0]
		],
		inverse
	);
}

function stopMarkup(paint: GradientPaint): string {
	const stops = [...paint.gradientStops].sort((left, right) => left.position - right.position);
	return stops
		.map((stop) => {
			const opacity = stop.color.a * paint.opacity;
			return `<stop offset="${formatNumber(stop.position)}" stop-color="${colorHex(stop.color)}" stop-opacity="${formatNumber(opacity)}"/>`;
		})
		.join('');
}

function gradientMarkup(paint: GradientPaint, size: Size, defs: SvgDefs): string | null {
	const matrix = gradientMatrix(paint, size);
	if (matrix === null || paint.gradientStops.length === 0) return null;
	const id = defs.nextId('gradient');
	const common = `id="${id}" gradientUnits="userSpaceOnUse" gradientTransform="${matrixAttribute(matrix)}"`;
	if (paint.type === 'GRADIENT_LINEAR') {
		defs.add(
			`<linearGradient ${common} x1="0" y1="0.5" x2="1" y2="0.5">${stopMarkup(paint)}</linearGradient>`
		);
		return id;
	}
	if (paint.type === 'GRADIENT_RADIAL') {
		defs.add(
			`<radialGradient ${common} cx="0.5" cy="0.5" r="0.5">${stopMarkup(paint)}</radialGradient>`
		);
		return id;
	}
	defs.warnings.add(`${paint.type} has no SVG equivalent; exported as a radial gradient`);
	defs.add(
		`<radialGradient ${common} cx="0.5" cy="0.5" r="0.5">${stopMarkup(paint)}</radialGradient>`
	);
	return id;
}

/** The `fill=` (or `stroke=`) attributes of one paint, or `null` when it draws nothing. */
export function paintAttributes(
	kind: 'fill' | 'stroke',
	paint: Paint,
	size: Size,
	defs: SvgDefs
): string | null {
	if (!paint.visible || paint.opacity <= 0) return null;
	if (paint.type === 'IMAGE') {
		defs.warnings.add('image fills are not exported to SVG');
		return null;
	}
	if (paint.type === 'SOLID') {
		return `${kind}="${colorHex(paint.color)}"${opacityAttribute(kind, paint.opacity)}`;
	}
	const id = gradientMarkup(paint, size, defs);
	if (id === null) return null;
	return `${kind}="url(#${id})"`;
}

function opacityAttribute(kind: 'fill' | 'stroke', opacity: number): string {
	if (opacity >= 1) return '';
	return ` ${kind}-opacity="${formatNumber(opacity)}"`;
}

/** Cap, join, miter limit and dashes of a stroke as attributes (without width and paint). */
export function strokeStyleAttributes(stroke: Stroke): string {
	const parts: string[] = [];
	if (stroke.cap === 'ROUND') parts.push('stroke-linecap="round"');
	if (stroke.cap === 'SQUARE') parts.push('stroke-linecap="square"');
	if (stroke.join === 'ROUND') parts.push('stroke-linejoin="round"');
	if (stroke.join === 'BEVEL') parts.push('stroke-linejoin="bevel"');
	if (stroke.join === 'MITER' && stroke.miterLimit !== 4) {
		parts.push(`stroke-miterlimit="${formatNumber(stroke.miterLimit)}"`);
	}
	if (stroke.dashPattern.length > 0) {
		parts.push(`stroke-dasharray="${stroke.dashPattern.map(formatNumber).join(' ')}"`);
	}
	return parts.join(' ');
}

function shadowFilterPart(effect: ShadowEffect, index: number): string {
	return (
		`<feGaussianBlur in="SourceAlpha" stdDeviation="${formatNumber(effect.radius / 2)}" result="blur${index}"/>` +
		`<feOffset in="blur${index}" dx="${formatNumber(effect.offset.x)}" dy="${formatNumber(effect.offset.y)}" result="offset${index}"/>` +
		`<feFlood flood-color="${colorHex(effect.color)}" flood-opacity="${formatNumber(effect.color.a)}" result="color${index}"/>` +
		`<feComposite in="color${index}" in2="offset${index}" operator="in" result="shadow${index}"/>`
	);
}

/** A `<filter>` for the visible drop shadows and layer blur of a node; `null` when there are none. */
export function effectsFilter(effects: readonly Effect[], defs: SvgDefs): string | null {
	const shadows: ShadowEffect[] = [];
	let blur = 0;
	for (const effect of effects) {
		if (!effect.visible) continue;
		if (effect.type === 'DROP_SHADOW') shadows.push(effect);
		if (effect.type === 'LAYER_BLUR') blur = Math.max(blur, effect.radius);
		if (effect.type === 'INNER_SHADOW' || effect.type === 'BACKGROUND_BLUR') {
			defs.warnings.add(`${effect.type} is not exported to SVG`);
		}
	}
	if (shadows.length === 0 && blur === 0) return null;
	const id = defs.nextId('filter');
	let body = shadows.map((shadow, index) => shadowFilterPart(shadow, index)).join('');
	let source = 'SourceGraphic';
	if (blur > 0) {
		body += `<feGaussianBlur in="SourceGraphic" stdDeviation="${formatNumber(blur / 2)}" result="blurred"/>`;
		source = 'blurred';
	}
	const nodes = shadows.map((_, index) => `<feMergeNode in="shadow${index}"/>`);
	nodes.push(`<feMergeNode in="${source}"/>`);
	body += `<feMerge>${nodes.join('')}</feMerge>`;
	defs.add(
		`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${body}</filter>`
	);
	return id;
}
