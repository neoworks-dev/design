import type { Context } from '@neoworks/extension-system';
import ScissorsIcon from 'phosphor-svelte/lib/ScissorsIcon';
import { createNode } from '../../lib/document';
import { CreationPreview, createCreationTool } from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';
import SliceOutlines from './SliceOutlines.svelte';

// The Slice tool (S): drag or click to create an export region. A slice has no fill and does not
// render; it is a dashed outline on the canvas (the overlay below) and carries export settings,
// one PNG at 1x to begin with, which the export epic consumes.
export default {
	name: 'tool-slice',
	inject: ['tools', 'document', 'selection', 'viewport', 'regions'],
	apply(ctx: Context): void {
		const preview = new CreationPreview();
		const handlers = createCreationTool(
			ctx,
			{
				nodeType: 'SLICE',
				label: 'Slice',
				geometry: 'box',
				build: (placement, name) =>
					createNode('SLICE', {
						name,
						...placement,
						exportSettings: [{ suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } }]
					})
			},
			preview
		);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'slice',
					title: 'Slice',
					icon: ScissorsIcon,
					shortcut: 'S',
					group: 'create',
					order: 10.2,
					cursor: 'crosshair',
					toolbar: false,
					overlay: { component: CreationPreviewOverlay, props: { preview } },
					...handlers
				}),
			'slice tool'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'tool-slice/outlines',
					region: 'canvas-overlay',
					component: SliceOutlines
				}),
			'slice outlines overlay'
		);
	}
};
