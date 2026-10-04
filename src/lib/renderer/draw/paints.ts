// Document paints to Skia paints, and the fills of a node. Colors arrive already resolved through
// the variable resolver (the SceneSource hands over resolved nodes), never raw stored values.

import type { BlendMode as SkiaBlendMode, Paint as SkiaPaint, Path } from 'canvaskit-wasm';
import type { BlendMode, Paint } from '../../document/types';
import type { Size } from '../../kernel/types';
import type { DrawContext } from './context';

type SkiaBlendModeName =
	| 'SrcOver'
	| 'Darken'
	| 'Multiply'
	| 'ColorBurn'
	| 'Lighten'
	| 'Screen'
	| 'Plus'
	| 'ColorDodge'
	| 'Overlay'
	| 'SoftLight'
	| 'HardLight'
	| 'Difference'
	| 'Exclusion'
	| 'Hue'
	| 'Saturation'
	| 'Color'
	| 'Luminosity';

// Skia has no linear burn; multiply is the closest of its modes.
const BLEND_MODE_NAMES: Record<BlendMode, SkiaBlendModeName> = {
	PASS_THROUGH: 'SrcOver',
	NORMAL: 'SrcOver',
	DARKEN: 'Darken',
	MULTIPLY: 'Multiply',
	LINEAR_BURN: 'Multiply',
	COLOR_BURN: 'ColorBurn',
	LIGHTEN: 'Lighten',
	SCREEN: 'Screen',
	LINEAR_DODGE: 'Plus',
	COLOR_DODGE: 'ColorDodge',
	OVERLAY: 'Overlay',
	SOFT_LIGHT: 'SoftLight',
	HARD_LIGHT: 'HardLight',
	DIFFERENCE: 'Difference',
	EXCLUSION: 'Exclusion',
	HUE: 'Hue',
	SATURATION: 'Saturation',
	COLOR: 'Color',
	LUMINOSITY: 'Luminosity'
};

export function skiaBlendMode(context: DrawContext, mode: BlendMode): SkiaBlendMode {
	return context.canvasKit.BlendMode[BLEND_MODE_NAMES[mode]];
}

/** True for blend modes that only mean something when the node is composited as a unit. */
export function isIsolatingBlendMode(mode: BlendMode): boolean {
	return mode !== 'NORMAL' && mode !== 'PASS_THROUGH';
}

/**
 * A Skia paint for `paint`, or null when it cannot be drawn (hidden, or a gradient or image with
 * no shader hook yet). The caller sets style and stroke attributes.
 */
export function createSkiaPaint(context: DrawContext, paint: Paint, size: Size): SkiaPaint | null {
	if (!paint.visible) return null;
	const { canvasKit, scope } = context;
	const skiaPaint = scope.own(new canvasKit.Paint());
	skiaPaint.setAntiAlias(true);
	skiaPaint.setBlendMode(skiaBlendMode(context, paint.blendMode));
	if (paint.type === 'SOLID') {
		const { r, g, b } = paint.color;
		skiaPaint.setColor(canvasKit.Color4f(r, g, b, paint.opacity));
		return skiaPaint;
	}
	const shader = context.hooks.shaderForPaint(context, paint, size);
	if (shader === null) return null;
	skiaPaint.setShader(shader);
	skiaPaint.setAlphaf(paint.opacity);
	return skiaPaint;
}

/** Fills bottom to top (the first fill is the lowest). Returns how many were drawn. */
export function drawFills(
	context: DrawContext,
	fills: readonly Paint[],
	path: Path,
	size: Size
): number {
	let drawn = 0;
	for (const fill of fills) {
		const skiaPaint = createSkiaPaint(context, fill, size);
		if (skiaPaint === null) continue;
		skiaPaint.setStyle(context.canvasKit.PaintStyle.Fill);
		context.canvas.drawPath(path, skiaPaint);
		drawn += 1;
	}
	return drawn;
}
