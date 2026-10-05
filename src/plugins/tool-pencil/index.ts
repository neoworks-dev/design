import type { Context } from '@neoworks/extension-system';
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
import { z } from 'zod';
import { createPencilTool, PencilState, pencilOverlay } from '../../lib/vector/pencilTool';

const DEFAULT_TOLERANCE = 2;

const PencilConfig = z
	.object({
		/** Smoothing: the largest deviation of the fitted curve from the drawn points, in pixels. */
		tolerance: z.number().positive().default(DEFAULT_TOLERANCE)
	})
	.default({ tolerance: DEFAULT_TOLERANCE });

export type PencilSettings = z.infer<typeof PencilConfig>;

// The pencil tool (Shift+P): freehand strokes collected from the pointer (coalesced events
// included) and fitted with cubic curves (Schneider) on release. The result is one VECTOR node
// with a stroke, created in one undo step. `tolerance` is the smoothing setting.
export default {
	name: 'tool-pencil',
	inject: ['tools', 'document', 'selection', 'viewport', 'overlay'],
	Config: PencilConfig,
	apply(ctx: Context, config: PencilSettings): void {
		const state = new PencilState();
		const tolerance = (): number => config.tolerance;
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'pencil',
					title: 'Pencil',
					icon: PencilSimpleIcon,
					shortcut: 'Shift+P',
					group: 'create',
					toolbarGroup: 'pen',
					order: 12.1,
					cursor: 'crosshair',
					...createPencilTool(ctx, state, { tolerance })
				}),
			'pencil tool'
		);
		ctx.effect(() => ctx.overlay.register(pencilOverlay(state)), 'pencil overlay');
	}
};
