import type { Context } from '@neoworks/extension-system';
import type { PanelTabContribution } from '../../lib/registries/panels.svelte';
import type { ToolContribution } from '../../lib/registries/tools.svelte';
import FileTab from './FileTab.svelte';
import PlaceholderText from './PlaceholderText.svelte';
import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircleIcon';
import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
import TextTIcon from 'phosphor-svelte/lib/TextTIcon';

// Stand-in content for the workbench regions until the real plugins (layers panel, property
// sections, canvas, tools) exist. Each real plugin replaces one entry here and this plugin
// shrinks to nothing.
export default {
	name: 'placeholder-shell',
	inject: ['menus', 'panels', 'tools'],
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

		// The canvas input router emits the request; this stand-in opens the empty-canvas menu.
		ctx.on('canvas/contextmenu', (event) => ctx.menus.openFromEvent('canvas-empty', event));

		const tools: ToolContribution[] = [
			{
				id: 'pen',
				title: 'Pen',
				icon: PenNibIcon,
				shortcut: 'P',
				group: 'create',
				order: 12,
				cursor: 'crosshair'
			},
			{
				id: 'text',
				title: 'Text',
				icon: TextTIcon,
				shortcut: 'T',
				group: 'create',
				order: 13,
				cursor: 'text'
			},
			{
				id: 'comment',
				title: 'Comment',
				icon: ChatCircleIcon,
				shortcut: 'C',
				group: 'view',
				order: 21
			}
		];
		for (const tool of tools) {
			ctx.effect(() => ctx.tools.register(tool), `placeholder tool ${tool.id}`);
		}
	}
};
