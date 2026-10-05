import type { Context } from '@neoworks/extension-system';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { ShapeHandleFeedbackState } from '../../lib/selecting/shapeHandleFeedback.svelte';
import { ShapeHandleGesture } from '../../lib/selecting/shapeHandleGesture';
import ShapeHandles from '../../lib/selecting/ShapeHandles.svelte';

// Shape specific handles on the selected node (docs/research/interactions.md section 4): corner
// radius for rectangles, frames and polygons (Alt drags one corner), arc start / sweep / inner
// radius for ellipses, point count and inner ratio for polygons and stars. They hide when the
// shape is small on screen. Interim DOM overlay in `canvas-overlay` until the overlay layer
// (#38). Maths in lib/selecting/shapeHandles.ts, the drag (history group) in
// shapeHandleGesture.ts.
export default {
	name: 'shape-handles',
	inject: ['selection', 'document', 'history', 'viewport', 'regions', 'tools'],
	apply(ctx: Context): void {
		const feedback = new ShapeHandleFeedbackState();
		const gesture = new ShapeHandleGesture(ctx, feedback);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'shape-handles/overlay',
					region: 'canvas-overlay',
					component: ShapeHandles,
					props: { feedback, gesture }
				}),
			'shape handles overlay'
		);

		ctx.effect(() => watchGestureKeys([gesture]), 'shape handle key handling');
	}
};
