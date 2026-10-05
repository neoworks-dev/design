import type { Context } from '@neoworks/extension-system';
import { AiService, type AiServiceOptions } from '../../lib/services/ai';
import { AiState } from '../../lib/services/aiState.svelte';

// The `ai` service (#143): typed API over the bridge to the agent in main, the run registry
// (status, origin tag, events) and the registry of document tools the agent may call. Streams from
// main (`ai:event`, `ai:tool-call`) are routed into it here. The `ai-tools` plugin registers the
// tools, `ai-history` groups a run's edits into one undo step, `ai-chat` is the panel.
export default {
	name: 'ai',
	inject: ['desktop', 'commands', 'document'],
	apply(ctx: Context, config?: AiServiceOptions): void {
		const ai = new AiService(ctx, ctx.desktop, ctx.document, new AiState(), config);

		ctx.desktop.on('ai:event', (message) => ai.handleStreamEvent(message));
		ctx.desktop.on('ai:tool-call', (message) => void ai.handleToolCall(message));
		ctx.effect(() => () => void ai.shutdown(), 'ai/shutdown on unload');

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai.cancel-run',
					title: 'Stop AI run',
					run: async () => {
						const active = ai.activeRun;
						if (active) await ai.cancel(active.id);
					}
				}),
			'command ai.cancel-run'
		);
	}
};
