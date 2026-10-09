import type { Context } from '@neoworks/extension-system';
import { persistLayout, publishCollapsedKeys, type LayoutStorage } from './layoutState.svelte';
import { WorkbenchLayoutService } from './service';
import Workbench from './Workbench.svelte';

function browserStorage(): LayoutStorage | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	return localStorage;
}

export interface WorkbenchLayoutConfig {
	/** Where sizes and collapsed sidebars persist. Defaults to localStorage. */
	storage?: LayoutStorage;
}

// Defines the `root` layout: top-bar, left | canvas (+ floating toolbar and overlay) | right.
// Without this plugin the route shows its empty state.
export default {
	name: 'workbench-layout',
	inject: ['regions', 'commands', 'keymap', 'menus', 'contextKeys'],
	apply(ctx: Context, config?: WorkbenchLayoutConfig): void {
		const storage = config?.storage ?? browserStorage();
		const service = new WorkbenchLayoutService(ctx, storage);
		const layout = service.state;

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'workbench-layout/root',
					region: 'root',
					component: Workbench
				}),
			'workbench-layout/root region'
		);

		ctx.effect(
			() => publishCollapsedKeys(layout, ctx.contextKeys),
			'workbench-layout/collapsed keys'
		);

		ctx.on('panels/tab-activated', (side) => layout.expandSidebar(side));

		if (storage) {
			ctx.effect(() => persistLayout(layout, storage), 'workbench-layout/persist');
		}

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'workbench-layout.toggle-ui',
					title: 'Show/Hide UI',
					run: () => layout.toggleUi()
				}),
			'command workbench-layout.toggle-ui'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'workbench-layout.toggle-left-sidebar',
					title: 'Show/Hide left sidebar',
					run: () => layout.toggleSidebar('left')
				}),
			'command workbench-layout.toggle-left-sidebar'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'workbench-layout.toggle-right-sidebar',
					title: 'Show/Hide right sidebar',
					run: () => layout.toggleSidebar('right')
				}),
			'command workbench-layout.toggle-right-sidebar'
		);

		const viewMenuItems = [
			{ id: 'toggle-ui', command: 'workbench-layout.toggle-ui', order: 0 },
			{ id: 'toggle-left-sidebar', command: 'workbench-layout.toggle-left-sidebar', order: 1 },
			{ id: 'toggle-right-sidebar', command: 'workbench-layout.toggle-right-sidebar', order: 2 }
		];
		for (const item of viewMenuItems) {
			ctx.effect(
				() => ctx.menus.register({ menu: 'app/view', item: { ...item, group: '2_layout' } }),
				`menu app/view ${item.id}`
			);
		}
		for (const item of viewMenuItems) {
			ctx.effect(
				() =>
					ctx.menus.register({ menu: 'context/canvas-empty', item: { ...item, group: '9_view' } }),
				`menu context/canvas-empty ${item.id}`
			);
		}

		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+\\',
					command: 'workbench-layout.toggle-ui',
					scope: 'global'
				}),
			'shortcut Mod+\\'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Shift+\\',
					command: 'workbench-layout.toggle-left-sidebar',
					scope: 'global'
				}),
			'shortcut Mod+Shift+\\'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Mod+Alt+\\',
					command: 'workbench-layout.toggle-right-sidebar',
					scope: 'global'
				}),
			'shortcut Mod+Alt+\\'
		);
	}
};
