// Seams for drawing features that live in later issues. The scene drawer calls these at fixed
// points in the per-node draw order; the defaults draw nothing. A feature replaces its hook when
// the backend is created (`new CanvasKitBackend(..., hooks)`), so shapes, paints and strokes never
// need to know about gradients, images, effects or text.

import type { Shader } from 'canvaskit-wasm';
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
	/** The glyphs of a text node (#43); fills and strokes of text go through here too. */
	drawText(context: DrawContext, node: TextNode): void;
}

export const DEFAULT_DRAW_HOOKS: DrawHooks = {
	shaderForPaint: () => null,
	drawEffectsBehind: () => {},
	drawEffectsInside: () => {},
	drawText: () => {}
};
