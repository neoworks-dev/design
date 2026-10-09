import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import type { AiRunInfo } from '../../lib/ai/types';
import { BATCH_OPERATIONS } from '../../lib/ai/batch';
import { PROMPT_SUGGESTIONS_MENU } from '../../lib/ai/selectionPrompt';
import { contributeCommand } from '../../lib/editing/contribute';
import { AiBatchService, type BatchApplied } from '../../lib/services/aiBatch';
import { AiBatchState } from '../../lib/services/aiBatchState.svelte';
import BatchToast from './BatchToast.svelte';

const textItems = z.strictObject({
	items: z
		.array(z.strictObject({ id: z.string(), text: z.string() }))
		.min(1)
		.describe('One entry per layer of the task')
});
const layoutItems = z.strictObject({
	items: z
		.array(z.strictObject({ id: z.string(), direction: z.enum(['HORIZONTAL', 'VERTICAL']) }))
		.min(1)
		.describe('One entry per frame of the task')
});

function schemaOf(schema: z.ZodType): Record<string, unknown> {
	const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
	delete inputSchema.$schema;
	return inputSchema;
}

const ACTIONS_MENU = 'context/actions';

// Batch operations of the AI (#152), over the selection or the whole page: `ai-batch.alt-text`,
// `ai-batch.content-fill`, `ai-batch.auto-layout` (write tools `set_alt_text`, `fill_content`,
// `convert_to_auto_layout`, each limited to the layers the run was started for) and the read-only
// reports `ai-batch.audit` (colors and spacing) and `ai-batch.bindings` (variable binding
// suggestions). Commands are in the palette and in Actions in the context menus (the submenu
// entry belongs to ai-rename). One run is one undo step.
export default {
	name: 'ai-batch',
	inject: ['ai', 'document', 'selection', 'variables', 'commands', 'menus', 'panels', 'regions'],
	apply(ctx: Context): void {
		const batch = new AiBatchService(
			ctx,
			ctx.ai,
			ctx.document,
			ctx.selection,
			ctx.variables,
			() => ctx.panels.activateTab('ai-chat'),
			new AiBatchState()
		);

		const tools: {
			id: string;
			description: string;
			schema: z.ZodType;
			run: (run: AiRunInfo, input: unknown) => BatchApplied;
		}[] = [
			{
				id: 'set_alt_text',
				description: 'Store alt text on the image layers of an alt text task.',
				schema: textItems,
				run: (run, items) => batch.applyAltText(run, textItems.parse(items).items)
			},
			{
				id: 'fill_content',
				description: 'Replace the text of the placeholder text layers of a content task.',
				schema: textItems,
				run: (run, items) => batch.applyContent(run, textItems.parse(items).items)
			},
			{
				id: 'convert_to_auto_layout',
				description: 'Turn the frames of an auto layout task into stacks in the given direction.',
				schema: layoutItems,
				run: (run, items) => batch.applyAutoLayout(run, layoutItems.parse(items).items)
			}
		];
		for (const tool of tools) {
			ctx.effect(
				() =>
					ctx.ai.registerTool({
						id: tool.id,
						description: tool.description,
						write: true,
						taskOnly: true,
						inputSchema: schemaOf(tool.schema),
						run: (input, run) => JSON.stringify(tool.run(run, input))
					}),
				`ai tool ${tool.id}`
			);
		}

		BATCH_OPERATIONS.forEach((operation, position) => {
			contributeCommand(ctx, {
				id: `ai-batch.${operation.id}`,
				title: operation.title,
				run: () => batch.run(operation.id),
				menus: [
					{ menu: ACTIONS_MENU, group: '2_batch', order: position },
					{ menu: PROMPT_SUGGESTIONS_MENU, group: '1_suggestions', order: 10 + position }
				]
			});
		});

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-batch/toast',
					region: 'canvas-overlay',
					component: BatchToast
				}),
			'ai batch toast'
		);
	}
};
