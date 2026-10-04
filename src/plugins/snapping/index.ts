import type { Context } from '@neoworks/extension-system';
import { contributeCommand } from '../../lib/editing/contribute';
import { DEFAULT_SNAP_THRESHOLD_PIXELS, SnappingService } from '../../lib/services/snapping';
import { SnappingState } from '../../lib/services/snappingState.svelte';
import { drawSnapOverlay } from '../../lib/snapping/overlayDraw';

export interface SnappingConfig {
	/** Start with snapping on (default) or off. */
	enabled?: boolean;
	/** Screen pixels within which an edge snaps. */
	thresholdPixels?: number;
}

function thresholdOf(value: number | undefined): number {
	if (value === undefined) return DEFAULT_SNAP_THRESHOLD_PIXELS;
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_SNAP_THRESHOLD_PIXELS;
	return value;
}

// The `snapping` service: object snapping and equal-spacing guides for the move, resize and draw
// tools, Alt+hover distance measurement, plus the global "Snap to objects" switch. Guides, gap
// brackets and the measurement live in reactive service state; a small contribution to the
// `overlay` service draws them (red lines, x marks, distance labels) and redraws when that state
// changes. A tool calls `snap` / `measure` / `release`.
export default {
	name: 'snapping',
	inject: ['document', 'spatial', 'viewport', 'commands', 'menus', 'overlay'],
	apply(ctx: Context, config?: SnappingConfig): void {
		const state = new SnappingState();
		if (config && config.enabled === false) state.enabled = false;
		const snapping = new SnappingService(
			ctx,
			ctx.document,
			ctx.spatial,
			ctx.viewport,
			state,
			thresholdOf(config?.thresholdPixels)
		);
		contributeCommand(ctx, {
			id: 'snapping.toggle',
			title: 'Snap to objects',
			run: () => snapping.setEnabled(!snapping.enabled),
			menus: [{ menu: 'app/view', group: '4_snapping' }]
		});
		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'snapping/guides',
					order: 50,
					track: () => {
						void snapping.guides;
						void snapping.gaps;
						void snapping.measurement;
					},
					draw: (frame) =>
						drawSnapOverlay(frame, {
							guides: snapping.guides,
							gaps: snapping.gaps,
							measurement: snapping.measurement
						})
				}),
			'snapping/overlay guides'
		);
	}
};
