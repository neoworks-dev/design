import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { base64Of } from '../../lib/ai/tools/documentTools';
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

const screenshotInput = z.strictObject({
	nodeId: z
		.string()
		.optional()
		.describe('Layer to show; default the first selected layer, else the first top-level layer')
});

// Model context from the selection (#147): `aiContext.build()` is the compact text of the selected
// subtrees, the page and what the document offers, within a size budget. The `get_screenshot`
// tool lets the model look at the selection (a PNG of its area, everything overlapping included).
export default {
	name: 'ai-context',
	inject: ['ai', 'selection', 'document', 'variables', 'headlessRenderer'],
	Config: aiContextConfigSchema,
	apply(ctx: Context, config: AiContextConfig): void {
		const service = new AiContextService(
			ctx,
			ctx.document,
			ctx.selection,
			ctx.variables,
			ctx.headlessRenderer,
			{
				...DEFAULT_CONTEXT_BUDGET,
				maxChars: config.maxChars,
				maxSelectedRoots: config.maxSelectedLayers
			}
		);
		const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(screenshotInput) };
		delete inputSchema.$schema;
		ctx.effect(
			() =>
				ctx.ai.registerTool({
					id: 'get_screenshot',
					description:
						'A screenshot (PNG) of the selected layer, or of the given layer, as the user sees it.',
					write: false,
					inputSchema,
					run: async (input) => {
						const parsed = screenshotInput.parse(input ?? {});
						const image = await service.screenshot(parsed.nodeId);
						return JSON.stringify({
							width: image.width,
							height: image.height,
							mimeType: image.mimeType,
							base64: base64Of(image.bytes)
						});
					}
				}),
			'ai tool get_screenshot'
		);
	}
};
