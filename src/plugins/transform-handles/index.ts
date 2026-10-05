import type { Context } from '@neoworks/extension-system';
import { HandleInteraction } from '../../lib/selecting/handleInteraction';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';

const MODIFIER_KEYS = ['Shift', 'Alt', 'Control', 'Meta'];

// Eight resize handles on the selection box and the size pill (docs/research/interactions.md
// section 4). They draw on the overlay; the canvas input router hit-tests them as a pointer
// claimant, so the Move tool never sees a handle press. The resize maths lives in
// lib/selecting/resize.ts, the gesture (history group, snapping) in resizeGesture.ts.
export default {
	name: 'transform-handles',
	inject: [
		'selection',
		'document',
		'history',
		'snapping',
		'viewport',
		'overlay',
		'canvasInput',
		'tools'
	],
	apply(ctx: Context): void {
		const feedback = new ResizeFeedbackState();
		const gesture = new ResizeGesture(ctx, feedback);
		const handles = new HandleInteraction(ctx, feedback, gesture);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'transform-handles/handles',
					order: 60,
					track: () => handles.track(),
					draw: (frame) => handles.draw(frame)
				}),
			'transform handles overlay'
		);
		ctx.effect(() => ctx.canvasInput.claim(handles), 'transform handles pointer claim');

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
