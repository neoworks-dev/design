import type { Context } from '@neoworks/extension-system';
import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
import { createPenTool, PenState, penOverlay } from '../../lib/vector/penTool';

// The pen tool (P): click for corner points, click-drag for smooth points with symmetric handles,
// Shift constrains to 45 degrees. Clicking the first point closes the path, Esc or Enter ends an
// open one, clicking a vertex of the selected vector continues or branches it. The whole build is
// one undo step at commit; Ctrl+Z removes the last point while building. The tool stays active
// after a path (Esc again leaves it); the draft is drawn through the overlay service.
export default {
	name: 'tool-pen',
	inject: ['tools', 'document', 'selection', 'viewport', 'overlay'],
	apply(ctx: Context): void {
		const state = new PenState();
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'pen',
					title: 'Pen',
					icon: PenNibIcon,
					shortcut: 'P',
					group: 'create',
					toolbarGroup: 'pen',
					order: 12,
					cursor: 'crosshair',
					...createPenTool(ctx, state)
				}),
			'pen tool'
		);
		ctx.effect(() => ctx.overlay.register(penOverlay(ctx, state)), 'pen overlay');
	}
};
