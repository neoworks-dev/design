import type { Context } from '@neoworks/extension-system';
import { drawAiHistoryHighlight } from './highlight';
import { AiHistoryService } from '../../lib/services/aiHistory';
import { AiHistoryState } from '../../lib/services/aiHistoryState.svelte';

// AI edits as undoable, attributed change sets (#145). A run's first write opens a history group
// that closes when the run ends, so a whole run is one undo step labelled with the prompt. The
// service keeps the audit trail (what each run changed, where its step is in the undo stack) and
// can revert a run. What the last run touched is outlined on the canvas until the user edits or
// selects something; `ai.toggle-run-highlight` switches that off. Commands: `ai.revert-last-run`.
export default {
	name: 'ai-history',
	inject: ['history', 'document', 'ai', 'overlay', 'commands'],
	apply(ctx: Context): void {
		const aiHistory = new AiHistoryService(
			ctx,
			ctx.history,
			ctx.document,
			ctx.ai,
			new AiHistoryState()
		);

		ctx.on('document/begin', (meta) => aiHistory.handleBegin(meta));
		ctx.on('document/change', (event) => aiHistory.handleChange(event));
		ctx.on('document/replace', () => aiHistory.handleDocumentReplace());
		ctx.on('ai/run-end', (run, status) => aiHistory.handleRunEnd(run, status));
		ctx.on('selection/change', () => aiHistory.clearHighlight());
		// A run that is still open when the plugin unloads must not leave the history locked.
		ctx.effect(() => () => aiHistory.closeOpenGroups(), 'ai-history/close groups on unload');

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'ai-history/highlight',
					order: 42,
					track: () => {
						void aiHistory.highlightedIds;
						void ctx.document.revision;
					},
					draw: (frame) => drawAiHistoryHighlight(frame, ctx.document, aiHistory)
				}),
			'ai run highlight overlay'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai.revert-last-run',
					title: 'Undo last AI run',
					run: () => {
						aiHistory.revertLastRun();
					}
				}),
			'command ai.revert-last-run'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai.toggle-run-highlight',
					title: 'Show/hide AI changes highlight',
					run: () => aiHistory.setHighlightEnabled(!aiHistory.highlightEnabled)
				}),
			'command ai.toggle-run-highlight'
		);
	}
};
