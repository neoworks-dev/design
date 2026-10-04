// Shaders for gradient and image paints (#36). Pure of the kernel: images come in through the
// `ImageSource` the caller provides, so the same code serves the app (image-cache) and tests.
//
// Gradient paints store a `gradientTransform` from the node's normalized box (0..1) to gradient
// space, where a linear gradient runs from (0, 0.5) to (1, 0.5) and radial, angular and diamond
// gradients are centered on (0.5, 0.5) with radius 0.5. Skia draws in that space and a local
// matrix `scale(width, height) * inverse(gradientTransform)` carries it into the node.

import type { CanvasKit, Image, RuntimeEffect, Shader } from 'canvaskit-wasm';
import { composeMatrices, invertMatrix } from '../../document/matrix';
import type { ColorStop, GradientPaint, ImagePaint, Matrix2x3 } from '../../document/types';
import type { Size } from '../../kernel/types';
import type { ImageStatus } from '../imageCache';
import type { SkiaTracker } from '../ownership';
import type { DrawContext } from './context';
import { toCanvasKitMatrix } from './matrix';

export interface ImageSource {
	/** The decoded image; undefined while it loads or when it is missing. */
	peek(hash: string): Image | undefined;
	status(hash: string): ImageStatus;
}

const MAX_DIAMOND_STOPS = 16;

const DIAMOND_SKSL = `
uniform float4 colors[${MAX_DIAMOND_STOPS}];
uniform float positions[${MAX_DIAMOND_STOPS}];
uniform float stopCount;

half4 main(float2 coordinates) {
	float t = clamp((abs(coordinates.x - 0.5) + abs(coordinates.y - 0.5)) * 2.0, 0.0, 1.0);
	float4 color = colors[0];
	for (int index = 1; index < ${MAX_DIAMOND_STOPS}; index++) {
		if (float(index) < stopCount) {
			float low = positions[index - 1];
			float high = positions[index];
			float amount = clamp((t - low) / max(high - low, 0.00001), 0.0, 1.0);
			color = mix(color, colors[index], amount);
		}
	}
	return half4(half3(color.rgb * color.a), half(color.a));
}
`;

function scaleMatrix(x: number, y: number): Matrix2x3 {
	return [
		[x, 0, 0],
		[0, y, 0]
	];
}

function translateMatrix(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

/** Maps points of gradient space (or normalized image space) into the node's box. */
export function normalizedToNode(transform: Matrix2x3, size: Size): Matrix2x3 | null {
	const inverse = invertMatrix(transform);
	if (inverse === null) return null;
	return composeMatrices(scaleMatrix(size.width, size.height), inverse);
}

function sortedStops(stops: readonly ColorStop[]): ColorStop[] {
	const sorted = [...stops].sort((left, right) => left.position - right.position);
	if (sorted.length === 1) return [sorted[0], sorted[0]];
	return sorted;
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export class PaintShaderFactory {
	private diamondEffect: RuntimeEffect | null | undefined;

	constructor(
		private readonly canvasKit: CanvasKit,
		private readonly tracker: SkiaTracker,
		private readonly images: ImageSource
	) {}

	/** Null when the paint cannot be drawn (no stops, singular transform). */
	shaderFor(context: DrawContext, paint: GradientPaint | ImagePaint, size: Size): Shader | null {
		if (paint.type === 'IMAGE') return this.imageShader(context, paint, size);
		return this.gradientShader(context, paint, size);
	}

	dispose(): void {
		if (this.diamondEffect) this.diamondEffect.delete();
		this.diamondEffect = undefined;
	}

	// ---------- gradients ----------

	private gradientShader(context: DrawContext, paint: GradientPaint, size: Size): Shader | null {
		if (paint.gradientStops.length === 0) return null;
		const matrix = normalizedToNode(paint.gradientTransform, size);
		if (matrix === null) return null;
		const stops = sortedStops(paint.gradientStops);
		if (paint.type === 'GRADIENT_DIAMOND') return this.diamondShader(context, stops, matrix);
		return this.skiaGradient(context, paint.type, stops, matrix);
	}

	private skiaGradient(
		context: DrawContext,
		type: GradientPaint['type'],
		stops: readonly ColorStop[],
		matrix: Matrix2x3
	): Shader | null {
		const { canvasKit } = this;
		const colors = stops.map(({ color }) => canvasKit.Color4f(color.r, color.g, color.b, color.a));
		const positions = stops.map((stop) => clampUnit(stop.position));
		const local = toCanvasKitMatrix(matrix);
		const clamp = canvasKit.TileMode.Clamp;
		if (type === 'GRADIENT_LINEAR') {
			return context.scope.own(
				canvasKit.Shader.MakeLinearGradient([0, 0.5], [1, 0.5], colors, positions, clamp, local)
			);
		}
		if (type === 'GRADIENT_RADIAL') {
			return context.scope.own(
				canvasKit.Shader.MakeRadialGradient([0.5, 0.5], 0.5, colors, positions, clamp, local)
			);
		}
		return context.scope.own(
			canvasKit.Shader.MakeSweepGradient(0.5, 0.5, colors, positions, clamp, local)
		);
	}

	private diamondShader(
		context: DrawContext,
		stops: readonly ColorStop[],
		matrix: Matrix2x3
	): Shader | null {
		const effect = this.diamond();
		if (effect === null) return null;
		const used = stops.slice(0, MAX_DIAMOND_STOPS);
		const uniforms = new Float32Array(MAX_DIAMOND_STOPS * 5 + 1);
		for (let index = 0; index < MAX_DIAMOND_STOPS; index += 1) {
			const stop = used[Math.min(index, used.length - 1)];
			uniforms.set([stop.color.r, stop.color.g, stop.color.b, stop.color.a], index * 4);
			uniforms[MAX_DIAMOND_STOPS * 4 + index] = clampUnit(stop.position);
		}
		uniforms[MAX_DIAMOND_STOPS * 5] = used.length;
		return context.scope.own(effect.makeShader(uniforms, toCanvasKitMatrix(matrix)));
	}

	private diamond(): RuntimeEffect | null {
		if (this.diamondEffect !== undefined) return this.diamondEffect;
		const effect = this.canvasKit.RuntimeEffect.Make(DIAMOND_SKSL);
		if (effect === null) {
			this.diamondEffect = null;
			return null;
		}
		this.diamondEffect = this.tracker.track(effect);
		return this.diamondEffect;
	}

	// ---------- images ----------

	private imageShader(context: DrawContext, paint: ImagePaint, size: Size): Shader | null {
		const image = this.images.peek(paint.imageHash);
		if (image === undefined) return this.placeholder(context, this.images.status(paint.imageHash));
		const matrix = imageMatrix(paint, image.width(), image.height(), size);
		if (matrix === null) return null;
		const { TileMode, FilterMode, MipmapMode } = this.canvasKit;
		let tile = TileMode.Decal;
		if (paint.scaleMode === 'TILE') tile = TileMode.Repeat;
		if (paint.scaleMode === 'FILL') tile = TileMode.Clamp;
		return context.scope.own(
			image.makeShaderOptions(
				tile,
				tile,
				FilterMode.Linear,
				MipmapMode.Linear,
				toCanvasKitMatrix(matrix)
			)
		);
	}

	/** Flat color while an image decodes (grey) or when its bytes are missing (rose). */
	private placeholder(context: DrawContext, status: ImageStatus): Shader {
		const { canvasKit } = this;
		let color = canvasKit.Color4f(0.88, 0.88, 0.9, 1);
		if (status === 'missing') color = canvasKit.Color4f(0.96, 0.78, 0.8, 1);
		return context.scope.own(canvasKit.Shader.MakeColor(color, canvasKit.ColorSpace.SRGB));
	}
}

// ---------- image placement (pure) ----------

/** Rotates the image box by `rotation` degrees clockwise and moves it back to the origin. */
function rotationMatrix(rotation: number, width: number, height: number): Matrix2x3 {
	if (rotation === 90) {
		return [
			[0, -1, height],
			[1, 0, 0]
		];
	}
	if (rotation === 180) {
		return [
			[-1, 0, width],
			[0, -1, height]
		];
	}
	if (rotation === 270) {
		return [
			[0, 1, 0],
			[-1, 0, width]
		];
	}
	return [
		[1, 0, 0],
		[0, 1, 0]
	];
}

/**
 * Maps image pixels to node space for an image paint: rotation first, then the scale mode.
 * FILL covers the box, FIT contains the image, CROP uses `imageTransform` (node-normalized to
 * image-normalized, identity stretches), TILE repeats the image at `scalingFactor` from the
 * top-left corner. Null when the numbers cannot place an image (empty box, singular transform).
 */
export function imageMatrix(
	paint: ImagePaint,
	imageWidth: number,
	imageHeight: number,
	size: Size
): Matrix2x3 | null {
	if (imageWidth <= 0 || imageHeight <= 0 || size.width <= 0 || size.height <= 0) return null;
	let rotation = 0;
	if (paint.rotation !== undefined) rotation = paint.rotation;
	let rotatedWidth = imageWidth;
	let rotatedHeight = imageHeight;
	if (rotation === 90 || rotation === 270) {
		rotatedWidth = imageHeight;
		rotatedHeight = imageWidth;
	}
	const rotate = rotationMatrix(rotation, imageWidth, imageHeight);
	const placement = placementMatrix(paint, rotatedWidth, rotatedHeight, size);
	if (placement === null) return null;
	return composeMatrices(placement, rotate);
}

function placementMatrix(
	paint: ImagePaint,
	width: number,
	height: number,
	size: Size
): Matrix2x3 | null {
	if (paint.scaleMode === 'TILE') {
		let factor = 1;
		if (paint.scalingFactor !== undefined) factor = paint.scalingFactor;
		if (factor <= 0) return null;
		return scaleMatrix(factor, factor);
	}
	if (paint.scaleMode === 'CROP') return cropMatrix(paint, width, height, size);
	const widthRatio = size.width / width;
	const heightRatio = size.height / height;
	let scale = Math.min(widthRatio, heightRatio);
	if (paint.scaleMode === 'FILL') scale = Math.max(widthRatio, heightRatio);
	const offsetX = (size.width - width * scale) / 2;
	const offsetY = (size.height - height * scale) / 2;
	return composeMatrices(translateMatrix(offsetX, offsetY), scaleMatrix(scale, scale));
}

function cropMatrix(
	paint: ImagePaint,
	width: number,
	height: number,
	size: Size
): Matrix2x3 | null {
	let transform: Matrix2x3 = [
		[1, 0, 0],
		[0, 1, 0]
	];
	if (paint.imageTransform) transform = paint.imageTransform;
	const normalized = normalizedToNode(transform, size);
	if (normalized === null) return null;
	return composeMatrices(normalized, scaleMatrix(1 / width, 1 / height));
}
