import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { contributeCommand } from '../../lib/editing/contribute';
import { DEFAULT_SNAP_THRESHOLD_PIXELS, SnappingService } from '../../lib/services/snapping';
import { SnappingState } from '../../lib/services/snappingState.svelte';
import { updateConfig } from '../../lib/settings/updateConfig';
import { drawSnapOverlay } from '../../lib/snapping/overlayDraw';

// The plugin's settings (shown in Settings, stored by main). The two toggle commands update this
// config with `fiber.update`, so what the user last chose survives a restart.
const snappingConfigSchema = z
	.object({
		enabled: z.boolean().default(true).describe('Snap to objects while moving and resizing.'),
		thresholdPixels: z
			.number()
			.positive()
			.default(DEFAULT_SNAP_THRESHOLD_PIXELS)
			.describe('Screen pixels within which an edge snaps.'),
		pixelSnap: z.boolean().default(false).describe('Round positions to whole pixels.')
	})
	.prefault({});
export type SnappingConfig = z.infer<typeof snappingConfigSchema>;

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
	inject: ['document', 'spatial', 'viewport', 'commands', 'keymap', 'menus', 'overlay'],
	Config: snappingConfigSchema,
	apply(ctx: Context, config: SnappingConfig): void {
		const state = new SnappingState();
		state.enabled = config.enabled;
		const snapping = new SnappingService(
			ctx,
			ctx.document,
			ctx.spatial,
			ctx.viewport,
			state,
			thresholdOf(config.thresholdPixels)
		);
		// Creation tools snap the corner they place; guides go when the tool finishes or changes.
		ctx.on('tools/snap-point', (point, next) => {
			const base = next();
			const outcome = snapping.snap({ x: base.x, y: base.y, width: 0, height: 0 });
			return { x: base.x + outcome.delta.x, y: base.y + outcome.delta.y };
		});
		ctx.on('tools/snap-release', () => snapping.release());
		ctx.on('tools/change', () => snapping.release());
		contributeCommand(ctx, {
			id: 'snapping.toggle',
			title: 'Snap to objects',
			run: () => updateConfig(ctx.fiber, { ...config, enabled: !snapping.enabled }),
			menus: [{ menu: 'app/view', group: '4_snapping' }]
		});
		// Snap to pixel grid (#71): off by default, remembered through the settings. Applies to
		// move, resize and draw through `snap`, and to nudges through this waterfall.
		ctx.effect(() => {
			snapping.setPixelSnap(config.pixelSnap);
			return () => snapping.setPixelSnap(false);
		}, 'snapping/restore pixel snap');
		ctx.on('nudge/pixel-snap', (enabled, next) => enabled || next() || snapping.pixelSnapEnabled);
		contributeCommand(ctx, {
			id: 'snapping.toggle-pixel',
			title: 'Snap to pixel grid',
			keys: ["Mod+Shift+'"],
			run: () => updateConfig(ctx.fiber, { ...config, pixelSnap: !snapping.pixelSnapEnabled }),
			menus: [{ menu: 'app/view', group: '4_snapping', order: 1 }]
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
