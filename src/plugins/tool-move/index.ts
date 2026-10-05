import type { Context } from '@neoworks/extension-system';
import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
import { createMoveTool, MoveToolState } from '../../lib/selecting/moveTool.svelte';
import SelectionOverlay from '../../lib/selecting/SelectionOverlay.svelte';

// The Move tool (V), the default tool: click, Shift, Ctrl/Cmd and double-click selection, hover
// outline, marquee and the move gesture. The outlines are an interim DOM overlay in the
// `canvas-overlay` region until the overlay layer (#38) exists.
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
		'regions'
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
				ctx.regions.register({
					id: 'tool-move/selection-overlay',
					region: 'canvas-overlay',
					component: SelectionOverlay,
					props: { state }
				}),
			'selection overlay'
		);
	}
};
