import type { Context } from '@neoworks/extension-system';
import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
import { createMoveTool, MoveToolState } from '../../lib/selecting/moveTool.svelte';
import { drawSelectionFeedback, trackSelectionFeedback } from '../../lib/selecting/selectionDraw';

// The Move tool (V), the default tool: click, Shift, Ctrl/Cmd and double-click selection, hover
// outline, marquee and the move gesture. Outlines, marquee and snap guides draw on the overlay.
export default {
	name: 'tool-move',
	inject: [
		'tools',
		'selection',
		'hitTest',
		'document',
		'history',
		'viewport',
		'snapping',
		'overlay'
	],
	apply(ctx: Context): void {
		const state = new MoveToolState();

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'move',
					title: 'Move',
					icon: CursorIcon,
					shortcut: 'V',
					group: 'move',
					toolbarGroup: 'move',
					order: 0,
					cursor: 'default',
					...createMoveTool(ctx, state)
				}),
			'move tool'
		);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'tool-move/selection',
					order: 50,
					track: () => trackSelectionFeedback(ctx, state),
					draw: (frame) => drawSelectionFeedback(ctx, frame, state)
				}),
			'selection overlay'
		);
	}
};
