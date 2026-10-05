import type { Context } from '@neoworks/extension-system';
import { AiSelectionPromptService } from '../../lib/services/aiSelectionPrompt';
import { AiSelectionPromptState } from '../../lib/services/aiSelectionPromptState.svelte';
import SelectionPrompt from './SelectionPrompt.svelte';

// The AI button on the canvas: moving the pointer toward the top right corner of the selection
// (one layer or several) shows a sparkle button; it opens a prompt card that sends the request
// with the selection attached, into the chat's conversation and agent session. The card shows the
// run's progress and answer; "Open in chat" shows the whole run there.
export default {
	name: 'ai-selection-prompt',
	inject: [
		'ai',
		'aiChat',
		'selection',
		'document',
		'tools',
		'viewport',
		'regions',
		'panels',
		'commands'
	],
	apply(ctx: Context): void {
		const service = new AiSelectionPromptService(
			ctx,
			ctx.ai,
			ctx.aiChat,
			ctx.selection,
			ctx.document,
			ctx.tools,
			() => ctx.panels.activateTab('ai-chat'),
			new AiSelectionPromptState()
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-selection-prompt/button',
					region: 'canvas-overlay',
					component: SelectionPrompt
				}),
			'ai selection prompt overlay'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-selection-prompt.open',
					title: 'Ask AI about the selection',
					when: 'hasSelection',
					run: () => service.open()
				}),
			'command ai-selection-prompt.open'
		);

		ctx.on('selection/change', () => service.handleSelectionChange());
		ctx.effect(() => () => service.close(), 'ai-selection-prompt/close on unload');
	}
};
