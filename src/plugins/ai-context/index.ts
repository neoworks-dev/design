import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { DEFAULT_CONTEXT_BUDGET } from '../../lib/ai/context';
import { AiContextService } from '../../lib/services/aiContext';

const aiContextConfigSchema = z
	.object({
		maxChars: z
			.number()
			.int()
			.positive()
			.default(DEFAULT_CONTEXT_BUDGET.maxChars)
			.describe('Longest selection context added to a prompt, in characters.'),
		maxSelectedLayers: z
			.number()
			.int()
			.positive()
			.default(DEFAULT_CONTEXT_BUDGET.maxSelectedRoots)
			.describe('Most selected layers described one by one.')
	})
	.prefault({});
type AiContextConfig = z.infer<typeof aiContextConfigSchema>;

// Model context from the selection (#147): `aiContext.build()` is the compact text of the selected
// subtrees, the page and what the document offers, within a size budget, attached to prompts. The
// model looks at the selection with the general `screenshot` tool (ai-tools).
export default {
	name: 'ai-context',
	inject: ['selection', 'document', 'variables', 'headlessRenderer'],
	Config: aiContextConfigSchema,
	apply(ctx: Context, config: AiContextConfig): void {
		new AiContextService(ctx, ctx.document, ctx.selection, ctx.variables, ctx.headlessRenderer, {
			...DEFAULT_CONTEXT_BUDGET,
			maxChars: config.maxChars,
			maxSelectedRoots: config.maxSelectedLayers
		});
	}
};
