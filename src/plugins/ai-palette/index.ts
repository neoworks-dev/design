import type { Context } from '@neoworks/extension-system';
import { AiPaletteService } from '../../lib/services/aiPalette';
import { AiPaletteState } from '../../lib/services/aiPaletteState.svelte';
import AskToast from './AskToast.svelte';

const SOURCE_ID = 'ask-ai';

// The palette's natural-language mode (#152): the "Ask AI" tab (command `ai-palette.open`). Any
// text becomes one row, "Ask AI: ...", that starts a run limited to running app commands
// (`list_commands`, `run_command` and the reads). It uses the palette's `fallback` hook, so the
// tab has no list of its own. An answer toast reports what happened; Stop cancels the run.
export default {
	name: 'ai-palette',
	inject: ['ai', 'aiContext', 'palette', 'commands', 'panels', 'regions'],
	apply(ctx: Context): void {
		const service = new AiPaletteService(
			ctx,
			ctx.ai,
			ctx.aiContext,
			() => ctx.panels.activateTab('ai-chat'),
			new AiPaletteState()
		);

		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: SOURCE_ID,
					title: 'Ask AI',
					order: 30,
					placeholder: 'Tell the AI what to do, e.g. align these to left',
					ranked: true,
					items: () => [],
					fallback: (query) => {
						if (!service.canAsk) return undefined;
						return {
							id: 'ask',
							title: `Ask AI: “${query.trim()}”`,
							subtitle: 'Runs app commands for you',
							run: () => void service.ask(query)
						};
					}
				}),
			'palette source ask-ai'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-palette.open',
					title: 'Ask the AI to do something',
					run: () => ctx.palette.open(SOURCE_ID)
				}),
			'command ai-palette.open'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-palette/toast',
					region: 'canvas-overlay',
					component: AskToast
				}),
			'ai palette toast'
		);
		ctx.effect(() => () => void service.cancel(), 'ai-palette/cancel on unload');
	}
};
