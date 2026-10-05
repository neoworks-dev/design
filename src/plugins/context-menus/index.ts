import type { Context } from '@neoworks/extension-system';
import { objectArguments } from '../../lib/editing/contribute';
import {
	ContextMenusService,
	SELECT_LAYER_COMMAND,
	SELECT_LAYER_MENU
} from '../../lib/services/contextMenus';

const PLUGIN_MENUS = [
	'context/canvas',
	'context/layer',
	'context/canvas-empty',
	'context/layer-panel'
];

const SELECTION_MENUS = ['context/canvas', 'context/layer'];

// Groups of commands the feature plugins register under their own menu path; the context menus
// show each as one submenu so the menu stays short.
const SUBMENUS = [
	{ id: 'align', title: 'Align and distribute', path: 'context/align', group: '2_align' },
	{ id: 'boolean', title: 'Boolean groups', path: 'context/boolean', group: '4_boolean' }
];

// Opens the context menus: the canvas right click (`canvas/contextmenu` from the canvas input
// router) and, through the `contextMenus` service, the layers panel. The entries themselves come
// from the feature plugins; this plugin adds the cross-cutting ones: the "Select layer" stack
// under the cursor and the empty "Plugins" submenu that third-party plugins fill.
export default {
	name: 'context-menus',
	inject: ['menus', 'commands', 'selection', 'hitTest', 'document', 'viewport', 'renderer'],
	apply(ctx: Context): void {
		const service = new ContextMenusService(
			ctx,
			ctx.menus,
			ctx.selection,
			ctx.hitTest,
			ctx.document,
			ctx.viewport,
			() => ctx.renderer.canvasElement
		);

		ctx.on('canvas/contextmenu', (event) => service.openOnCanvas(event));

		ctx.effect(
			() =>
				ctx.commands.register({
					id: SELECT_LAYER_COMMAND,
					title: 'Select layer',
					run: (args) => {
						const id = objectArguments(args).id;
						if (typeof id !== 'string') return;
						ctx.selection.select([id], 'replace', { source: 'canvas' });
					}
				}),
			'command select layer'
		);
		ctx.effect(() => () => service.clearLayerItems(), 'select layer stack items');

		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'context/canvas',
					item: {
						id: 'select-layer',
						title: 'Select layer',
						submenu: SELECT_LAYER_MENU,
						group: '6_select'
					}
				}),
			'menu select layer'
		);
		for (const submenu of SUBMENUS) {
			for (const menu of SELECTION_MENUS) {
				ctx.effect(
					() =>
						ctx.menus.register({
							menu,
							item: {
								id: submenu.id,
								title: submenu.title,
								submenu: submenu.path,
								group: submenu.group
							}
						}),
					`menu ${menu} ${submenu.id} submenu`
				);
			}
		}
		for (const menu of PLUGIN_MENUS) {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu,
						item: {
							id: 'plugins',
							title: 'Plugins',
							submenu: 'context/plugins',
							group: '9_plugins'
						}
					}),
				`menu ${menu} plugins submenu`
			);
		}
	}
};
