import type { Context } from '@neoworks/extension-system';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { contributeHandles, HandleInteraction } from '../../lib/selecting/handleInteraction';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import { RotateGesture } from '../../lib/selecting/rotateGesture';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';

// Eight resize handles on the selection box, the rotation zones just outside its corners and the
// size / angle pill (docs/research/interactions.md section 4). They draw on the overlay; the
// canvas input router hit-tests them as a pointer claimant, so the Move tool never sees a handle
// press. The resize maths lives in lib/selecting/resize.ts, the gesture (history group, snapping)
// in resizeGesture.ts; rotation is in rotate.ts and rotateGesture.ts (edge handles never rotate).
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
		const rotation = new RotateGesture(ctx, feedback);
		const handles = new HandleInteraction(ctx, feedback, gesture, {
			id: 'transform-handles/handles',
			toolId: 'move',
			rotation
		});

		contributeHandles(ctx, handles);

		ctx.effect(() => watchGestureKeys([gesture, rotation]), 'resize key handling');
	}
};
