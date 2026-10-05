import type { Context } from '@neoworks/extension-system';
import SelectionBackgroundIcon from 'phosphor-svelte/lib/SelectionBackgroundIcon';
import { createNode } from '../../lib/document';
import { CreationPreview, createCreationTool } from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';

// The Section tool (Shift+S): drag or click to create a section, always on the page. A section
// organises: no constraints, no auto layout, and it does not clip. It carries a white fill,
// and nodes dropped into it move with it (the Move tool's drop targets include sections). Its
// title label is drawn by the frame labels overlay of `tool-frame`.
export default {
	name: 'tool-section',
	inject: ['tools', 'document', 'selection'],
	apply(ctx: Context): void {
		const preview = new CreationPreview();
		const handlers = createCreationTool(
			ctx,
			{
				nodeType: 'SECTION',
				label: 'Section',
				geometry: 'box',
				container: 'page',
				build: (placement, name) =>
					createNode('SECTION', {
						name,
						...placement,
						fills: [
							{
								type: 'SOLID',
								visible: true,
								opacity: 1,
								blendMode: 'NORMAL',
								color: { r: 1, g: 1, b: 1 }
							}
						]
					})
			},
			preview
		);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'section',
					title: 'Section',
					icon: SelectionBackgroundIcon,
					shortcut: 'Shift+S',
					group: 'create',
					order: 10.1,
					cursor: 'crosshair',
					toolbar: false,
					overlay: { component: CreationPreviewOverlay, props: { preview } },
					...handlers
				}),
			'section tool'
		);
	}
};
