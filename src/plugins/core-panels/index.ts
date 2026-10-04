import type { Context } from '@neoworks/extension-system';
import {
	PanelState,
	PanelsService,
	persistPanelState,
	publishModeKey,
	type PanelSide,
	type PanelStorage
} from '../../lib/registries/panels.svelte';
import SidebarHost from './SidebarHost.svelte';

function browserStorage(): PanelStorage | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	return localStorage;
}

export interface CorePanelsConfig {
	/** Where the active tabs and collapsed sections persist. Defaults to localStorage. */
	storage?: PanelStorage;
}

// The `panels` service plus the two sidebar hosts. A sidebar host fills the `left` / `right`
// region only while it has a visible tab, so a window without panel plugins shows no sidebar.
export default {
	name: 'core-panels',
	inject: ['regions', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context, config?: CorePanelsConfig): void {
		const storage = config?.storage ?? browserStorage();
		const state = new PanelState(storage);
		const panels = new PanelsService(ctx, ctx.commands, ctx.keymap, ctx.contextKeys, state);

		const sides: PanelSide[] = ['left', 'right'];
		for (const side of sides) {
			ctx.effect(
				() =>
					ctx.regions.register({
						id: `core-panels/${side}`,
						region: side,
						component: SidebarHost,
						props: { side },
						when: () => panels.tabs(side).length > 0
					}),
				`panels ${side} sidebar`
			);
		}

		if (storage) ctx.effect(() => persistPanelState(state, storage), 'panels/persist');
		ctx.effect(() => publishModeKey(state, ctx.contextKeys), 'panels/mode key');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'panels.toggle-dev-mode',
					title: 'Toggle Dev Mode',
					run: () => {
						if (panels.mode === 'dev') panels.setMode('design');
						else panels.setMode('dev');
					}
				}),
			'command panels.toggle-dev-mode'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'panels.toggle-design-prototype',
					title: 'Toggle Design and Prototype',
					when: "mode == 'design'",
					run: () => {
						const activeId = panels.activeTab('right')?.id;
						if (activeId === 'prototype') panels.activateTab('design');
						else panels.activateTab('prototype');
					}
				}),
			'command panels.toggle-design-prototype'
		);

		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Shift+D',
					command: 'panels.toggle-dev-mode',
					scope: 'global'
				}),
			'shortcut Shift+D'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Shift+E',
					command: 'panels.toggle-design-prototype',
					scope: 'global'
				}),
			'shortcut Shift+E'
		);
	}
};
