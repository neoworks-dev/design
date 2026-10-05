// Hover measurements in dev mode: with something selected, hovering another layer shows the
// distances to it without holding Alt. Reads reactive selection and mode state, so it runs as an
// effect root that the plugin disposes.

import type { Context } from '@neoworks/extension-system';
import { untrack } from 'svelte';

export function watchHoverMeasurements(ctx: Context): () => void {
	return $effect.root(() => {
		$effect(() => {
			const hovered = ctx.selection.hoverId;
			const selected = [...ctx.selection.ids];
			if (ctx.panels.mode !== 'dev' || hovered === null || selected.length === 0) {
				untrack(() => ctx.snapping.clearMeasurement());
				return;
			}
			untrack(() => ctx.snapping.measure({ selectionIds: selected, targetId: hovered }));
		});
		return () => ctx.snapping.clearMeasurement();
	});
}
