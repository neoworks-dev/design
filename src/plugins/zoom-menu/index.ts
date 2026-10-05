import type { Context } from '@neoworks/extension-system';
import { ZOOM_MENU } from './zoomValue';
import ZoomMenu from './ZoomMenu.svelte';

interface ZoomMenuItem {
	command: string;
	group: string;
}

// Commands the zoom dropdown runs; the commands themselves belong to the `viewport` and
// `pixel-grid` plugins; an item whose command is not registered shows disabled.
const ITEMS: ZoomMenuItem[] = [
	{ command: 'viewport.zoom-in', group: '1_zoom' },
	{ command: 'viewport.zoom-out', group: '1_zoom' },
	{ command: 'viewport.zoom-100', group: '1_zoom' },
	{ command: 'viewport.zoom-to-fit', group: '1_zoom' },
	{ command: 'viewport.zoom-to-selection', group: '1_zoom' },
	{ command: 'view.toggle-pixel-grid', group: '2_toggles' },
	{ command: 'view.toggle-pixel-preview', group: '2_toggles' }
];

// The zoom control of the top bar: an editable percentage (type a value, Enter) with a dropdown
// of zoom commands and view toggles. The dropdown is the `toolbar/zoom` menu, so any plugin can
// add to it. This is the only zoom control; the design panel header no longer has one.
export default {
	name: 'zoom-menu',
	inject: ['viewport', 'menus', 'regions', 'commands'],
	apply(ctx: Context): void {
		ITEMS.forEach((item, position) => {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu: ZOOM_MENU,
						item: { id: item.command, command: item.command, group: item.group, order: position }
					}),
				`menu ${ZOOM_MENU} ${item.command}`
			);
		});

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'zoom-menu/control',
					region: 'top-bar',
					component: ZoomMenu,
					order: 50
				}),
			'zoom menu control'
		);
	}
};
