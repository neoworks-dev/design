import type { Context } from '@neoworks/extension-system';
import { ToolsService, ToolsState, publishToolKeys } from '../../lib/registries/tools.svelte';
import ToolOverlayHost from './ToolOverlayHost.svelte';

// The `tools` service, the host for the active tool's overlay component (region
// `canvas-overlay`) and Esc handling. The toolbar itself is the `toolbar` plugin.
export default {
	name: 'core-tools',
	inject: ['regions', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context): void {
		const tools = new ToolsService(
			ctx,
			ctx.commands,
			ctx.keymap,
			ctx.contextKeys,
			new ToolsState()
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'core-tools/overlay',
					region: 'canvas-overlay',
					component: ToolOverlayHost
				}),
			'tools overlay host'
		);

		ctx.effect(() => publishToolKeys(tools, ctx.contextKeys), 'tools/context keys');

		// Disabled on the default tool, where Esc belongs to selection.
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'tools.cancel',
					title: 'Cancel tool operation',
					when: '!toolIsDefault',
					run: () => void tools.cancel()
				}),
			'command tools.cancel'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Escape',
					command: 'tools.cancel',
					scope: 'global',
					// Esc ends the tool first; selection.deselect only runs on the default tool.
					priority: 10
				}),
			'shortcut Escape'
		);
	}
};
