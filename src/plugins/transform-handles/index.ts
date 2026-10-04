import type { Context } from '@neoworks/extension-system';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';
import TransformHandles from '../../lib/selecting/TransformHandles.svelte';

const MODIFIER_KEYS = ['Shift', 'Alt', 'Control', 'Meta'];

// Eight resize handles on the selection box and the size pill (docs/research/interactions.md
// section 4). The handles are an interim DOM overlay in `canvas-overlay` until the overlay layer
// (#38); they receive their own pointer events, so the Move tool never sees a handle press. The
// resize maths lives in lib/selecting/resize.ts, the gesture (history group, snapping) in
// resizeGesture.ts.
export default {
	name: 'transform-handles',
	inject: ['selection', 'document', 'history', 'snapping', 'viewport', 'regions', 'tools'],
	apply(ctx: Context): void {
		const feedback = new ResizeFeedbackState();
		const gesture = new ResizeGesture(ctx, feedback);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'transform-handles/overlay',
					region: 'canvas-overlay',
					component: TransformHandles,
					props: { feedback, gesture }
				}),
			'transform handles overlay'
		);

		// Capture phase: Esc aborts the resize before the keymap deselects, and modifier changes
		// re-plan the gesture while the pointer rests.
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
		}, 'resize key handling');
	}
};
