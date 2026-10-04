// Seams for drawing features that live in other plugins. The scene drawer calls these at fixed
// points in the per-node draw order; the defaults draw nothing. A feature registers its hook with
// the renderer (`ctx.renderer.registerDrawHooks`), so shapes, paints and strokes never need to
// know about gradients, images, effects or text.

import type { ImageFilter, Shader } from 'canvaskit-wasm';
import type { Size } from '../../kernel/types';
import type { GradientPaint, ImagePaint, SceneNode, TextNode } from '../../document/types';
import type { DrawContext } from './context';
import type { NodeShape } from './shape';

export interface DrawHooks {
	/**
	 * Gradient and image paints (#36). Returns a shader the scope owns, or null to skip the paint.
	 * `size` is the node's box: gradient and image transforms are relative to it.
	 */
	shaderForPaint(
		context: DrawContext,
		paint: GradientPaint | ImagePaint,
		size: Size
	): Shader | null;
	/** Effects painted below the node's own fills: drop shadows, background blur (#37). */
	drawEffectsBehind(context: DrawContext, node: SceneNode, shape: NodeShape): void;
	/** Effects painted over the fills and below the strokes: inner shadows (#37). */
	drawEffectsInside(context: DrawContext, node: SceneNode, shape: NodeShape): void;
	/** Image filter for the node's isolating layer: layer blur (#37). Null for none. */
	layerImageFilter(context: DrawContext, node: SceneNode): ImageFilter | null;
	/** The glyphs of a text node (#43); fills and strokes of text go through here too. */
	drawText(context: DrawContext, node: TextNode): void;
}

export const DEFAULT_DRAW_HOOKS: DrawHooks = {
	shaderForPaint: () => null,
	drawEffectsBehind: () => {},
	drawEffectsInside: () => {},
	layerImageFilter: () => null,
	drawText: () => {}
};

/**
 * The hooks the backend calls. Features register their part (`register`) and take it away again
 * by identity; with several registrations, `shaderForPaint` asks the newest first and the
 * drawing hooks all run, oldest first.
 */
export class DrawHookRegistry implements DrawHooks {
	private readonly layers: Partial<DrawHooks>[] = [];

	register(hooks: Partial<DrawHooks>): () => void {
		this.layers.push(hooks);
		return () => {
			const index = this.layers.indexOf(hooks);
			if (index !== -1) this.layers.splice(index, 1);
		};
	}

	get registrations(): number {
		return this.layers.length;
	}

	shaderForPaint(
		context: DrawContext,
		paint: GradientPaint | ImagePaint,
		size: Size
	): Shader | null {
		for (let index = this.layers.length - 1; index >= 0; index -= 1) {
			const layer = this.layers[index];
			if (!layer.shaderForPaint) continue;
			const shader = layer.shaderForPaint(context, paint, size);
			if (shader !== null) return shader;
		}
		return null;
	}

	drawEffectsBehind(context: DrawContext, node: SceneNode, shape: NodeShape): void {
		for (const layer of this.layers) {
			if (layer.drawEffectsBehind) layer.drawEffectsBehind(context, node, shape);
		}
	}

	drawEffectsInside(context: DrawContext, node: SceneNode, shape: NodeShape): void {
		for (const layer of this.layers) {
			if (layer.drawEffectsInside) layer.drawEffectsInside(context, node, shape);
		}
	}

	layerImageFilter(context: DrawContext, node: SceneNode): ImageFilter | null {
		for (let index = this.layers.length - 1; index >= 0; index -= 1) {
			const layer = this.layers[index];
			if (!layer.layerImageFilter) continue;
			const filter = layer.layerImageFilter(context, node);
			if (filter !== null) return filter;
		}
		return null;
	}

	drawText(context: DrawContext, node: TextNode): void {
		for (const layer of this.layers) {
			if (layer.drawText) layer.drawText(context, node);
		}
	}
}
