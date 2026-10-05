import type { Context } from '@neoworks/extension-system';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { ShapeHandleFeedbackState } from '../../lib/selecting/shapeHandleFeedback.svelte';
import { ShapeHandleGesture } from '../../lib/selecting/shapeHandleGesture';
import { ShapeHandleInteraction } from '../../lib/selecting/shapeHandleInteraction';

// Shape specific handles on the selected node (docs/research/interactions.md section 4): corner
// radius for rectangles, frames and polygons (Alt drags one corner), arc start / sweep / inner
// radius for ellipses, point count and inner ratio for polygons and stars. They hide when the
// shape is small on screen. Drawn on the overlay and hit-tested by the canvas input router. Maths
// in lib/selecting/shapeHandles.ts, the drag (history group) in shapeHandleGesture.ts.
export default {
	name: 'shape-handles',
	inject: ['selection', 'document', 'history', 'viewport', 'overlay', 'canvasInput', 'tools'],
	apply(ctx: Context): void {
		const feedback = new ShapeHandleFeedbackState();
		const gesture = new ShapeHandleGesture(ctx, feedback);
		const handles = new ShapeHandleInteraction(ctx, feedback, gesture);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: handles.id,
					order: 55,
					track: () => handles.track(),
					draw: (frame) => handles.draw(frame)
				}),
			'shape handles overlay'
		);
		ctx.effect(() => ctx.canvasInput.claim(handles), 'shape handles pointer claim');

		ctx.effect(() => watchGestureKeys([gesture]), 'shape handle key handling');
	}
};
