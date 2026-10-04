import type { Context } from '@neoworks/extension-system';
import CanvasPlaceholder from './CanvasPlaceholder.svelte';
import LeftPanel from './LeftPanel.svelte';
import RightPanel from './RightPanel.svelte';
import ToolbarPlaceholder from './ToolbarPlaceholder.svelte';

// Stand-in content for the workbench regions until the real plugins (layers panel, property
// sections, canvas, tools) exist. Each real plugin replaces one entry here and this plugin
// shrinks to nothing.
export default {
	name: 'placeholder-shell',
	inject: ['regions', 'menus'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'placeholder-shell/left',
					region: 'left',
					component: LeftPanel
				}),
			'placeholder left panel'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'placeholder-shell/right',
					region: 'right',
					component: RightPanel
				}),
			'placeholder right panel'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'placeholder-shell/canvas',
					region: 'canvas',
					component: CanvasPlaceholder
				}),
			'placeholder canvas'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'placeholder-shell/toolbar',
					region: 'toolbar',
					component: ToolbarPlaceholder
				}),
			'placeholder toolbar'
		);
	}
};
