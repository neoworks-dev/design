import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { DocumentTools } from '../../lib/ai/tools/documentTools';

// The plugin's settings (shown in Settings, stored by main). They are the run permissions of the
// document tools: how much one call or one run may do.
const aiToolsConfigSchema = z
	.object({
		maxOpsPerCall: z
			.number()
			.int()
			.positive()
			.default(200)
			.describe('Most operations one apply_changes call may carry.'),
		maxDeletionsPerRun: z
			.number()
			.int()
			.min(0)
			.default(50)
			.describe('Most layers one AI run may delete (0 forbids deleting).'),
		blockedCommandPrefixes: z
			.array(z.string())
			.default(['app.', 'file.', 'ai.', 'home.', 'tabs.', 'edit.undo', 'edit.redo'])
			.describe('Commands whose id starts with one of these are not available to the agent.'),
		maxImageBytes: z
			.number()
			.int()
			.positive()
			.default(1_500_000)
			.describe('Largest exported image the agent may receive, in bytes.'),
		maxResultChars: z
			.number()
			.int()
			.positive()
			.default(60_000)
			.describe('Longest text a read tool answers with.')
	})
	.prefault({});
export type AiToolsConfig = z.infer<typeof aiToolsConfigSchema>;

// The document as tools for the AI agent (#144): read_tree, get_selection, get_node, query,
// apply_changes, create_node, set_props, run_command, list_commands, export_png, list_variables,
// list_styles, list_components. Reads answer compact JSON with resolved values; every write goes
// through `document.apply` tagged `origin: 'ai'` with the run id. Write tools are only offered to
// runs with write scope.
export default {
	name: 'ai-tools',
	inject: ['ai', 'document', 'selection', 'commands', 'headlessRenderer', 'variables'],
	Config: aiToolsConfigSchema,
	apply(ctx: Context, config: AiToolsConfig): void {
		const tools = new DocumentTools(
			{
				document: ctx.document,
				selection: ctx.selection,
				commands: ctx.commands,
				variables: ctx.variables,
				headlessRenderer: ctx.headlessRenderer,
				ai: ctx.ai
			},
			config
		);
		for (const handler of tools.handlers()) {
			ctx.effect(() => ctx.ai.registerTool(handler), `ai tool ${handler.id}`);
		}
		ctx.on('ai/run-end', (run) => tools.forgetRun(run.id));
	}
};
