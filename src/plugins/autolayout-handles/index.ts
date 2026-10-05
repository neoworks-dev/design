import type { Context } from '@neoworks/extension-system';
import { HandlesFeedback } from './feedback.svelte';
import { AutoLayoutHandles } from './handles';
import { drawReorder, trackReorder } from './reorderDraw';
import { ReorderDrag } from './reorderDrag';

// Auto layout on the canvas (docs/research/interactions.md section 4). A selected auto layout
// frame shows pink handles on its padding sides and in the gaps between its children; dragging
// one changes the value (Alt mirrors the opposite side, Shift sets every side), one undo step per
// drag. Dragging a child inside an auto layout frame reorders it: the Move tool offers the drag
// through `move/begin`, this plugin answers with a `ReorderDrag` that shows the blue insertion
// line and commits the new position on drop. Handles draw on the overlay and take presses as a
// pointer claimant, so the Move tool never sees a press on one.
export default {
	name: 'autolayout-handles',
	inject: [
		'overlay',
		'autolayout',
		'canvasInput',
		'selection',
		'document',
		'history',
		'viewport',
		'tools'
	],
	apply(ctx: Context): void {
		const feedback = new HandlesFeedback();
		const handles = new AutoLayoutHandles(ctx, feedback);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: handles.id,
					order: 65,
					track: () => handles.track(),
					draw: (frame) => handles.draw(frame)
				}),
			'autolayout handles overlay'
		);
		ctx.effect(() => ctx.canvasInput.claim(handles), 'autolayout handles pointer claim');
		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'autolayout-handles/reorder',
					order: 70,
					track: () => trackReorder(feedback),
					draw: (frame) => drawReorder(ctx, feedback, frame)
				}),
			'autolayout reorder overlay'
		);
		ctx.on('move/begin', (request) => ReorderDrag.begin(ctx, feedback, request));
	}
};
