import type { Context } from '@neoworks/extension-system';
import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
import { AiChatService } from '../../lib/services/aiChat';
import { AiChatState } from '../../lib/services/aiChatState.svelte';
import AiChatPanel from './AiChatPanel.svelte';

// The AI chat (#146): a tab in the left sidebar (the right one is full) with the conversation of the open document
// (messages, streaming text, collapsible Reasoning and tool-call rows, a stop button), an input
// with attach-selection, a model picker and send, the consent prompt, retry for failed or stopped
// runs and an "Undo this run" link under the run that can still be taken back. All behaviour is in
// the `aiChat` service; it talks to the `ai` and `aiHistory` services only.
export default {
	name: 'ai-chat',
	inject: ['panels', 'ai', 'aiHistory', 'aiContext', 'document', 'commands'],
	apply(ctx: Context): void {
		new AiChatService(ctx, ctx.ai, ctx.aiHistory, ctx.document, ctx.aiContext, new AiChatState());

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'ai-chat',
					side: 'left',
					title: 'AI',
					icon: SparkleIcon,
					order: 3,
					component: AiChatPanel,
					shortcut: 'Alt+I'
				}),
			'ai chat tab'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-chat.open',
					title: 'Open AI chat',
					run: () => ctx.panels.activateTab('ai-chat')
				}),
			'command ai-chat.open'
		);
	}
};
