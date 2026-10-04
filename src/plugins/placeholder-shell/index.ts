import type { Context } from '@neoworks/extension-system';
import type { PanelTabContribution } from '../../lib/registries/panels.svelte';
import CanvasPlaceholder from './CanvasPlaceholder.svelte';
import FileTab from './FileTab.svelte';
import PlaceholderText from './PlaceholderText.svelte';
import ToolbarPlaceholder from './ToolbarPlaceholder.svelte';

// Stand-in content for the workbench regions until the real plugins (layers panel, property
// sections, canvas, tools) exist. Each real plugin replaces one entry here and this plugin
// shrinks to nothing.
export default {
	name: 'placeholder-shell',
	inject: ['regions', 'menus', 'panels'],
	apply(ctx: Context): void {
		const tabs: PanelTabContribution[] = [
			{ id: 'file', side: 'left', title: 'File', order: 0, shortcut: 'Alt+1', component: FileTab },
			{
				id: 'assets',
				side: 'left',
				title: 'Assets',
				order: 1,
				shortcut: 'Alt+2',
				component: PlaceholderText,
				props: { text: 'Placeholder: the assets panel replaces this.' }
			},
			{
				id: 'design',
				side: 'right',
				title: 'Design',
				order: 0,
				shortcut: 'Alt+8',
				when: "mode == 'design'"
			},
			{
				id: 'prototype',
				side: 'right',
				title: 'Prototype',
				order: 1,
				shortcut: 'Alt+9',
				when: "mode == 'design'",
				component: PlaceholderText,
				props: { text: 'Placeholder: prototype interactions replace this.' }
			},
			{
				id: 'inspect',
				side: 'right',
				title: 'Inspect',
				order: 2,
				when: "mode == 'dev'",
				component: PlaceholderText,
				props: { text: 'Placeholder: dev mode inspection replaces this.' }
			}
		];
		for (const tab of tabs) {
			ctx.effect(() => ctx.panels.registerTab(tab), `placeholder tab ${tab.id}`);
		}

		const sections = ['Page', 'Variables', 'Styles', 'Export'];
		sections.forEach((title, index) => {
			ctx.effect(
				() =>
					ctx.panels.registerSection({
						tab: 'design',
						id: title.toLowerCase(),
						title,
						order: index,
						component: PlaceholderText,
						props: { text: `Placeholder: the ${title.toLowerCase()} section replaces this.` }
					}),
				`placeholder section ${title}`
			);
		});

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
