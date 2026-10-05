import type { Context } from '@neoworks/extension-system';
import { ShapeHandleFeedbackState } from '../../lib/selecting/shapeHandleFeedback.svelte';
import { ShapeHandleGesture } from '../../lib/selecting/shapeHandleGesture';
import ShapeHandles from '../../lib/selecting/ShapeHandles.svelte';

const MODIFIER_KEYS = ['Shift', 'Alt', 'Control', 'Meta'];

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

		ctx.effect(() => {
			const keydown = (event: KeyboardEvent): void => {
				if (!gesture.isActive) return;
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					gesture.cancel();
					return;
				}
				if (MODIFIER_KEYS.includes(event.key)) gesture.refresh(event);
			};
			const keyup = (event: KeyboardEvent): void => {
				if (gesture.isActive && MODIFIER_KEYS.includes(event.key)) gesture.refresh(event);
			};
			window.addEventListener('keydown', keydown, true);
			window.addEventListener('keyup', keyup, true);
			return () => {
				gesture.cancel();
				window.removeEventListener('keydown', keydown, true);
				window.removeEventListener('keyup', keyup, true);
			};
		}, 'shape handle key handling');
	}
};
