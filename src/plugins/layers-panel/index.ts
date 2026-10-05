import type { Context } from '@neoworks/extension-system';
import { objectArguments } from '../../lib/editing/contribute';
import { LayersState } from '../../lib/layers/layersState.svelte';
import { LayersService } from '../../lib/services/layers';
import LayersSection from './LayersSection.svelte';

// The layers panel: the layer tree of the current page in the left sidebar's File tab, top-most
// first and in sync with the canvas selection. Provides the `layers` service (rows, expand state,
// rename state). Row clicks go through the selection service; right click opens the `layer`
// context menu through `contextMenus`.
export default {
	name: 'layers-panel',
	inject: ['panels', 'document', 'selection', 'commands', 'menus', 'contextMenus'],
	apply(ctx: Context): void {
		new LayersService(ctx, ctx.document, ctx.selection, new LayersState());

		ctx.effect(
			() =>
				ctx.panels.registerSection({
					tab: 'file',
					id: 'layers',
					title: 'Layers',
					order: 10,
					fill: true,
					component: LayersSection
				}),
			'layers section'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'layers.collapse-all',
					title: 'Collapse all layers',
					run: () => ctx.layers.collapseAll()
				}),
			'command layers.collapse-all'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'layers.toggle-expanded',
					title: 'Collapse/Expand',
					run: (args) => {
						const id = objectArguments(args).nodeId;
						if (typeof id === 'string') ctx.layers.toggleExpanded(id);
					}
				}),
			'command layers.toggle-expanded'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'context/layer',
					item: { id: 'toggle-expanded', command: 'layers.toggle-expanded', group: '7_layers' }
				}),
			'menu context/layer toggle-expanded'
		);
	}
};
