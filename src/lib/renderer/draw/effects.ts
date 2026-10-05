// Effects of a node (#37), reached through the draw hooks the `effects` plugin registers:
//   - drop shadow and background blur paint below the node's fills (`drawEffectsBehind`)
//   - inner shadow paints over the fills, clipped to the shape (`drawEffectsInside`)
//   - layer blur is an image filter on the node's isolating layer (`layerImageFilter`)
// Effects run in array order, first is lowest, like fills. Parameters come from the resolved node
// (variables already applied). A blur radius is twice the gaussian sigma, as in Figma.

import type { ImageFilter, Paint as SkiaPaint, Path, PathOp } from 'canvaskit-wasm';
import type {
	BlurEffect,
	Effect,
	SceneNode,
	ShadowEffect,
	StrokeWeights
} from '../../document/types';
import type { DrawContext } from './context';
import type { DrawHooks } from './hooks';
import { skiaBlendMode } from './paints';
import type { NodeShape } from './shape';

const SHADOW_MARGIN_SIGMAS = 3;

function effectsOf(node: SceneNode): readonly Effect[] {
	if (!('effects' in node)) return [];
	return node.effects;
}

function sigmaOf(radius: number): number {
	return Math.max(radius, 0) / 2;
}

export function drawEffectsBehind(context: DrawContext, node: SceneNode, shape: NodeShape): void {
	for (const effect of effectsOf(node)) {
		if (!effect.visible) continue;
		if (effect.type === 'DROP_SHADOW') drawDropShadow(context, node, shape, effect);
		if (effect.type === 'BACKGROUND_BLUR') drawBackgroundBlur(context, shape, effect);
	}
}

export function drawEffectsInside(context: DrawContext, node: SceneNode, shape: NodeShape): void {
	for (const effect of effectsOf(node)) {
		if (!effect.visible) continue;
		if (effect.type === 'INNER_SHADOW') drawInnerShadow(context, node, shape, effect);
	}
}

/** The blur filter for the node's layer, or null when it has no visible layer blur. */
export function layerImageFilter(context: DrawContext, node: SceneNode): ImageFilter | null {
	for (const effect of effectsOf(node)) {
		if (effect.visible && effect.type === 'LAYER_BLUR' && effect.radius > 0) {
			return blurFilter(context, effect);
		}
	}
	return null;
}

export function hasLayerBlur(node: SceneNode): boolean {
	return effectsOf(node).some((effect) => effect.visible && effect.type === 'LAYER_BLUR');
}

function blurFilter(context: DrawContext, effect: BlurEffect): ImageFilter {
	const { canvasKit, scope } = context;
	const sigma = sigmaOf(effect.radius);
	return scope.own(canvasKit.ImageFilter.MakeBlur(sigma, sigma, canvasKit.TileMode.Decal, null));
}

// ---------- shadows ----------

function drawDropShadow(
	context: DrawContext,
	node: SceneNode,
	shape: NodeShape,
	effect: ShadowEffect
): void {
	const silhouette = silhouetteOf(context, node, shape);
	if (silhouette === null) return;
	const { canvas, canvasKit } = context;
	const spread = spreadPath(context, silhouette, effect.spread);
	canvas.save();
	// Unless asked to show behind the node, the shadow is cut out under it (visible through
	// transparent fills only when `showShadowBehindNode`).
	if (effect.showShadowBehindNode !== true && shape.fillPath) {
		canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Difference, true);
	}
	canvas.translate(effect.offset.x, effect.offset.y);
	canvas.drawPath(spread, shadowPaint(context, effect));
	canvas.restore();
}

function drawInnerShadow(
	context: DrawContext,
	node: SceneNode,
	shape: NodeShape,
	effect: ShadowEffect
): void {
	const silhouette = silhouetteOf(context, node, shape);
	if (silhouette === null || shape.fillPath === null) return;
	const { canvas, canvasKit } = context;
	const hole = spreadPath(context, silhouette, -effect.spread);
	const margin =
		SHADOW_MARGIN_SIGMAS * sigmaOf(effect.radius) +
		Math.abs(effect.offset.x) +
		Math.abs(effect.offset.y) +
		Math.abs(effect.spread) +
		1;
	const bounds = shape.fillPath.getBounds();
	const around = context.scope.own(new canvasKit.PathBuilder());
	around.addRect([bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin]);
	const ring = combine(context, around.detachAndDelete(), hole, canvasKit.PathOp.Difference);
	if (ring === null) return;
	canvas.save();
	canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Intersect, true);
	canvas.translate(effect.offset.x, effect.offset.y);
	canvas.drawPath(ring, shadowPaint(context, effect));
	canvas.restore();
}

function shadowPaint(context: DrawContext, effect: ShadowEffect): SkiaPaint {
	const { canvasKit, scope } = context;
	const paint = newPaint(context);
	const { r, g, b, a } = effect.color;
	paint.setColor(canvasKit.Color4f(r, g, b, a));
	paint.setBlendMode(skiaBlendMode(context, effect.blendMode));
	const sigma = sigmaOf(effect.radius);
	if (sigma > 0) {
		const filter = canvasKit.MaskFilter.MakeBlur(canvasKit.BlurStyle.Normal, sigma, false);
		paint.setMaskFilter(scope.own(filter));
	}
	return paint;
}

function newPaint(context: DrawContext): SkiaPaint {
	const paint = context.scope.own(new context.canvasKit.Paint());
	paint.setAntiAlias(true);
	return paint;
}

/** What casts a shadow: the fill when there is one, otherwise the stroke outline. */
function silhouetteOf(context: DrawContext, node: SceneNode, shape: NodeShape): Path | null {
	if (!('fills' in node)) return null;
	if (shape.fillPath && node.fills.some((fill) => fill.visible)) return shape.fillPath;
	const stroke = node.strokes.find((candidate) => candidate.paints.some((paint) => paint.visible));
	if (!stroke) return null;
	const weight = strokeWeightOf(stroke.weight);
	if (weight <= 0) return null;
	return context.scope.ownOrNull(shape.strokePath.makeStroked({ width: weight }));
}

function strokeWeightOf(weight: number | StrokeWeights): number {
	if (typeof weight === 'number') return weight;
	return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

/** `path` grown by `spread` (shrunk when negative) by combining it with its own thick outline. */
function spreadPath(context: DrawContext, path: Path, spread: number): Path {
	if (spread === 0) return path;
	const { canvasKit } = context;
	const outline = context.scope.ownOrNull(
		path.makeStroked({ width: Math.abs(spread) * 2, join: canvasKit.StrokeJoin.Round })
	);
	if (outline === null) return path;
	const operation = spread > 0 ? canvasKit.PathOp.Union : canvasKit.PathOp.Difference;
	const combined = combine(context, path, outline, operation);
	if (combined === null) return path;
	return combined;
}

function combine(context: DrawContext, first: Path, second: Path, operation: PathOp): Path | null {
	return context.scope.ownOrNull(context.canvasKit.Path.MakeFromOp(first, second, operation));
}

// ---------- background blur ----------

/**
 * Blurs what is already drawn behind the node, inside its shape: a layer whose backdrop is the
 * blurred canvas, bounded to the node so the cost stays proportional to its size.
 */
function drawBackgroundBlur(context: DrawContext, shape: NodeShape, effect: BlurEffect): void {
	if (shape.fillPath === null || effect.radius <= 0) return;
	const { canvas, canvasKit } = context;
	canvas.save();
	canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Intersect, true);
	canvas.saveLayer(undefined, shape.fillPath.getBounds(), blurFilter(context, effect));
	context.counters.layers += 1;
	canvas.restore();
	canvas.restore();
}

/** What the `effects` plugin registers with the renderer. */
export const EFFECT_DRAW_HOOKS: Partial<DrawHooks> = {
	drawEffectsBehind,
	drawEffectsInside,
	layerImageFilter
};
