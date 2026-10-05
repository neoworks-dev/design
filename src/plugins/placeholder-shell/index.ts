import type { Context } from '@neoworks/extension-system';
import type { PanelTabContribution } from '../../lib/registries/panels.svelte';
import type { ToolContribution } from '../../lib/registries/tools.svelte';
import PlaceholderText from './PlaceholderText.svelte';
import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';

// Stand-in content for the workbench regions until the real plugins (layers panel, property
// sections, canvas, tools) exist. Each real plugin replaces one entry here and this plugin
// shrinks to nothing.
export default {
	name: 'placeholder-shell',
	inject: ['panels', 'tools'],
	apply(ctx: Context): void {
		const tabs: PanelTabContribution[] = [
			{ id: 'file', side: 'left', title: 'File', order: 0, shortcut: 'Alt+1' },
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
				id: 'prototype',
				side: 'right',
				title: 'Prototype',
				order: 1,
				shortcut: 'Alt+9',
				when: "mode == 'design'",
				component: PlaceholderText,
				props: { text: 'Placeholder: prototype interactions replace this.' }
			}
		];
		for (const tab of tabs) {
			ctx.effect(() => ctx.panels.registerTab(tab), `placeholder tab ${tab.id}`);
		}

		const tools: ToolContribution[] = [
			{
				id: 'pen',
				title: 'Pen',
				icon: PenNibIcon,
				shortcut: 'P',
				group: 'create',
				order: 12,
				cursor: 'crosshair'
			}
		];
		for (const tool of tools) {
			ctx.effect(() => ctx.tools.register(tool), `placeholder tool ${tool.id}`);
		}
	}
};
