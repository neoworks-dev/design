// Operations of the fill and stroke paint lists. Pure: each takes a list and returns a new one.

import type { GradientPaint, Paint, RGBA, SolidPaint, Stroke } from '../document/types';
import { defaultGradientTransform, type GradientType } from './gradient';

export type PaintKind = 'SOLID' | GradientType | 'IMAGE';

export const PAINT_KIND_LABELS: Record<PaintKind, string> = {
	SOLID: 'Solid',
	GRADIENT_LINEAR: 'Linear',
	GRADIENT_RADIAL: 'Radial',
	GRADIENT_ANGULAR: 'Angular',
	GRADIENT_DIAMOND: 'Diamond',
	IMAGE: 'Image'
};

export function solidPaint(color: { r: number; g: number; b: number }): SolidPaint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: color.r, g: color.g, b: color.b }
	};
}

/** The paint a "+" adds: Figma's light grey for fills, black for strokes. */
export function newPaint(role: 'fill' | 'stroke'): SolidPaint {
	if (role === 'stroke') return solidPaint({ r: 0, g: 0, b: 0 });
	return solidPaint({ r: 0.85, g: 0.85, b: 0.85 });
}

/** A stroke with the given paints and Figma's defaults: 1px, inside, mitered, solid line. */
export function defaultStroke(paints: Paint[]): Stroke {
	return {
		paints,
		weight: 1,
		align: 'INSIDE',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

/** The colour a paint shows as its swatch: a solid's colour, a gradient's first stop. */
export function representativeColor(paint: Paint): RGBA {
	if (paint.type === 'SOLID') return { ...paint.color, a: 1 };
	if (paint.type === 'IMAGE') return { r: 0.6, g: 0.6, b: 0.6, a: 1 };
	return paint.gradientStops[0].color;
}

function gradientFrom(paint: Paint, type: GradientType): GradientPaint {
	const color = representativeColor(paint);
	return {
		type,
		visible: paint.visible,
		opacity: paint.opacity,
		blendMode: paint.blendMode,
		gradientTransform: defaultGradientTransform(),
		gradientStops: [
			{ position: 0, color: { ...color, a: 1 } },
			{ position: 1, color: { ...color, a: 0 } }
		]
	};
}

/** Switch a paint to another kind, carrying over what survives (colour, opacity, blend). */
export function convertPaint(paint: Paint, kind: PaintKind): Paint {
	if (paint.type === kind) return paint;
	if (kind === 'IMAGE') return paint;
	if (kind === 'SOLID') {
		const color = representativeColor(paint);
		return { ...solidPaint(color), visible: paint.visible, opacity: paint.opacity };
	}
	if (paint.type !== 'SOLID' && paint.type !== 'IMAGE') return { ...paint, type: kind };
	return gradientFrom(paint, kind);
}

/** Move the entry at `from` to `to`. */
export function reorder<Item>(items: readonly Item[], from: number, to: number): Item[] {
	if (from === to || from < 0 || from >= items.length) return [...items];
	const target = Math.max(0, Math.min(items.length - 1, to));
	const next = [...items];
	const [moved] = next.splice(from, 1);
	next.splice(target, 0, moved);
	return next;
}

export function replaceAt<Item>(items: readonly Item[], index: number, item: Item): Item[] {
	return items.map((existing, at) => {
		if (at !== index) return existing;
		return item;
	});
}

export function removeAt<Item>(items: readonly Item[], index: number): Item[] {
	return items.filter((_, at) => at !== index);
}

/** Replace a solid paint's colour; the alpha of the picker becomes the paint's opacity. */
export function withSolidColor(paint: SolidPaint, color: RGBA): SolidPaint {
	const { boundVariables: _unbound, ...rest } = paint;
	return { ...rest, color: { r: color.r, g: color.g, b: color.b }, opacity: color.a };
}

/** Bind (or, with `null`, unbind) the colour of a solid paint to a variable. */
export function withBoundColor(paint: SolidPaint, variableId: string | null): SolidPaint {
	const { boundVariables: _existing, ...rest } = paint;
	if (variableId === null) return rest;
	return { ...rest, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variableId } } };
}

const CHECKER = 'conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0) 0 0 / 8px 8px';

function byte(channel: number): number {
	return Math.round(channel * 255);
}

function stopList(paint: GradientPaint): string {
	const parts = paint.gradientStops.map((stop) => {
		const { r, g, b, a } = stop.color;
		return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${a}) ${stop.position * 100}%`;
	});
	return parts.join(', ');
}

/** CSS background for a swatch: the paint over a checkerboard so transparency shows. */
export function paintCss(paint: Paint): string {
	if (paint.type === 'IMAGE') return `linear-gradient(135deg, #bbb, #888), ${CHECKER}`;
	if (paint.type === 'SOLID') {
		const { r, g, b } = paint.color;
		const color = `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${paint.opacity})`;
		return `linear-gradient(${color}, ${color}), ${CHECKER}`;
	}
	const stops = stopList(paint);
	if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(circle, ${stops}), ${CHECKER}`;
	if (paint.type === 'GRADIENT_ANGULAR') return `conic-gradient(${stops}), ${CHECKER}`;
	if (paint.type === 'GRADIENT_DIAMOND') {
		return `radial-gradient(closest-side, ${stops}), ${CHECKER}`;
	}
	return `linear-gradient(to right, ${stops}), ${CHECKER}`;
}
