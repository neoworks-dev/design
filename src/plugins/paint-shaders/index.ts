import type { Context } from '@neoworks/extension-system';
import { PaintShaderFactory } from '../../lib/renderer/draw/paintShaders';

// Gradient and image paints for the renderer: registers the `shaderForPaint` draw hook. Gradients
// are Skia shaders (diamond is an SkSL runtime effect), images come from the `images` cache and
// draw a flat placeholder until decoded or when their bytes are missing.
export default {
	name: 'paint-shaders',
	inject: ['renderer', 'canvaskit', 'images'],
	apply(ctx: Context): void {
		const { kit, tracker } = ctx.canvaskit;
		const factory = new PaintShaderFactory(kit, tracker, {
			peek: (hash) => ctx.images.peek(hash),
			status: (hash) => ctx.images.status(hash)
		});
		ctx.effect(() => () => factory.dispose(), 'paint-shaders/runtime effects');
		ctx.effect(
			() =>
				ctx.renderer.registerDrawHooks({
					shaderForPaint: (context, paint, size) => factory.shaderFor(context, paint, size)
				}),
			'paint-shaders/shader hook'
		);
	}
};
