import type { Context } from '@neoworks/extension-system';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import { RotateGesture } from '../../lib/selecting/rotateGesture';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';
import TransformHandles from '../../lib/selecting/TransformHandles.svelte';

// Eight resize handles on the selection box, the rotation zones just outside its corners and the
// size / angle pill (docs/research/interactions.md
// section 4). The handles are an interim DOM overlay in `canvas-overlay` until the overlay layer
// (#38); they receive their own pointer events, so the Move tool never sees a handle press. The
// resize maths lives in lib/selecting/resize.ts, the gesture (history group, snapping) in
// resizeGesture.ts; rotation is in rotate.ts and rotateGesture.ts (edge handles never rotate).
export default {
	name: 'transform-handles',
	inject: ['selection', 'document', 'history', 'snapping', 'viewport', 'regions', 'tools'],
	apply(ctx: Context): void {
		const feedback = new ResizeFeedbackState();
		const gesture = new ResizeGesture(ctx, feedback);
		const rotation = new RotateGesture(ctx, feedback);
		const gestures = [gesture, rotation];

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'transform-handles/overlay',
					region: 'canvas-overlay',
					component: TransformHandles,
					props: { feedback, gesture, rotation }
				}),
			'transform handles overlay'
		);

		// Capture phase: Esc aborts the resize before the keymap deselects, and modifier changes
		// re-plan the gesture while the pointer rests.
		ctx.effect(() => watchGestureKeys(gestures), 'resize key handling');
	}
};
