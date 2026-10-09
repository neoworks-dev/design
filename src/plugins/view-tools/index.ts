import type { Context } from '@neoworks/extension-system';
import HandIcon from 'phosphor-svelte/lib/HandIcon';
import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
import ZoomMarquee from './ZoomMarquee.svelte';
import { ViewToolState, createHandTool, createZoomTool } from './viewTools.svelte';

// The hand tool (H, hold Space, middle-drag) and the zoom tool (Z) on the `viewport` service.
// Hand is in the Move tool's dropdown, zoom is shortcut only.
export default {
	name: 'view-tools',
	inject: ['tools', 'viewport'],
	apply(ctx: Context): void {
		const toolState = new ViewToolState();

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'hand',
					title: 'Hand',
					icon: HandIcon,
					shortcut: 'H',
					hold: 'Space',
					group: 'move',
					toolbarGroup: 'move',
					toolbar: false,
					modes: ['design', 'dev'],
					order: 20,
					...createHandTool(ctx, toolState)
				}),
			'hand tool'
		);
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'zoom',
					title: 'Zoom',
					icon: MagnifyingGlassIcon,
					shortcut: 'Z',
					toolbar: false,
					overlay: { component: ZoomMarquee, props: { toolState } },
					...createZoomTool(ctx, toolState)
				}),
			'zoom tool'
		);
	}
};
