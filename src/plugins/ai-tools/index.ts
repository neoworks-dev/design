import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { CoreTools } from '../../lib/ai/tools/coreTools';

// The plugin's settings (shown in Settings, stored by main). They are the run permissions of the
// document tools: how much one call or one run may do.
const aiToolsConfigSchema = z
	.object({
		maxDeletionsPerRun: z
			.number()
			.int()
			.min(0)
			.default(50)
			.describe('Most layers one AI run may delete (0 forbids deleting).'),
		blockedCommandPrefixes: z
			.array(z.string())
			.default(['app.', 'file.', 'ai.', 'ai-', 'home.', 'tabs.', 'edit.undo', 'edit.redo'])
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

// The document as tools for the AI agent (#144): read, write, edit, screenshot and skill. The
// document reads and writes as HTML (src/lib/ai/html); every write goes through `document.apply`
// tagged `origin: 'ai'` with the run id, and write tools are only offered to runs with write
// scope. The plugin also contributes the skills behind these tools (html, edit, components,
// variables, styles, commands).
export default {
	name: 'ai-tools',
	inject: [
		'ai',
		'document',
		'selection',
		'commands',
		'headlessRenderer',
		'variables',
		'htmlLayout'
	],
	Config: aiToolsConfigSchema,
	apply(ctx: Context, config: AiToolsConfig): void {
		const tools = new CoreTools(
			{
				document: ctx.document,
				selection: ctx.selection,
				commands: ctx.commands,
				variables: ctx.variables,
				headlessRenderer: ctx.headlessRenderer,
				htmlLayout: ctx.htmlLayout,
				ai: ctx.ai
			},
			config
		);
		for (const handler of tools.handlers()) {
			ctx.effect(() => ctx.ai.registerTool(handler), `ai tool ${handler.id}`);
		}
		for (const skill of tools.skills()) {
			ctx.effect(() => ctx.ai.registerSkill(skill), `ai skill ${skill.id}`);
		}
		ctx.on('ai/run-end', (run) => tools.forgetRun(run.id));
	}
};
