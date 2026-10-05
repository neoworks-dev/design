import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import {
	generateDesignInput,
	templateById,
	TEMPLATES,
	type TemplateId
} from '../../lib/ai/generate';
import { objectArguments } from '../../lib/editing/contribute';
import { AiGenerateService } from '../../lib/services/aiGenerate';
import { AiGenerateState } from '../../lib/services/aiGenerateState.svelte';
import type { PaletteItem } from '../command-palette/service';
import GenerateStatus from './GenerateStatus.svelte';

const SOURCE_ID = 'generate';

/** `/generate [template] what to generate`: the template is optional. */
function parseSlashArgument(argument: string): { description: string; template: TemplateId } {
	const [first, ...rest] = argument.split(/\s+/);
	const template = templateById(first);
	if (template === undefined) return { description: argument, template: 'basic-app' };
	return { description: rest.join(' '), template: template.id };
}

// Generate designs from a prompt (#148): the palette tab "Generate" (one row per template), the
// command `ai-generate.open`, `ai-generate.run` ({ prompt, template }) and `/generate` in the AI
// chat. The model builds the design with the `generate_design` tool: one nested spec, auto layout
// frames, instances of the file's components, fills bound to its variables, placed beside the
// existing frames. One AI run, one undo step; stopping a run takes back what it built.
export default {
	name: 'ai-generate',
	inject: [
		'ai',
		'aiContext',
		'aiHistory',
		'aiChat',
		'document',
		'selection',
		'viewport',
		'variables',
		'commands',
		'palette',
		'panels',
		'regions'
	],
	apply(ctx: Context): void {
		const generate = new AiGenerateService(
			ctx,
			ctx.ai,
			ctx.aiContext,
			ctx.aiHistory,
			ctx.document,
			ctx.variables,
			{
				openChat: () => ctx.panels.activateTab('ai-chat'),
				reveal: (id) => {
					ctx.selection.select([id], 'replace', { source: 'canvas' });
					ctx.viewport.zoomToSelection();
				}
			},
			new AiGenerateState()
		);

		const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(generateDesignInput) };
		delete inputSchema.$schema;
		ctx.effect(
			() =>
				ctx.ai.registerTool({
					id: 'generate_design',
					description:
						'Build a whole design from a nested spec in one call: a FRAME root with auto layout and nested frames, text, shapes, component instances. Placed beside the existing frames. Only for generate tasks.',
					write: true,
					inputSchema,
					run: (input, run) => {
						const parsed = generateDesignInput.parse(input);
						return JSON.stringify(generate.applyDesign(run, parsed.root));
					}
				}),
			'ai tool generate_design'
		);

		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: SOURCE_ID,
					title: 'Generate',
					order: 27,
					placeholder: 'Describe the design to generate',
					ranked: true,
					items: (query) =>
						TEMPLATES.map((template): PaletteItem => {
							const description = query.trim();
							let subtitle = `${template.width} x ${template.height}`;
							if (description === '') subtitle = 'Describe what to generate first';
							return {
								id: template.id,
								title: template.label,
								subtitle,
								enabled: description !== '' && generate.canGenerate,
								run: () => void generate.generate(description, template.id)
							};
						})
				}),
			'palette source generate'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-generate.open',
					title: 'Generate design with AI',
					run: () => ctx.palette.open(SOURCE_ID)
				}),
			'command ai-generate.open'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-generate.run',
					title: 'Generate design from a prompt',
					run: async (args) => {
						const input = objectArguments(args);
						if (typeof input.prompt !== 'string') return;
						let template: TemplateId = 'basic-app';
						if (typeof input.template === 'string' && templateById(input.template)) {
							template = input.template as TemplateId;
						}
						await generate.generate(input.prompt, template);
					}
				}),
			'command ai-generate.run'
		);
		ctx.effect(
			() =>
				ctx.aiChat.registerSlashAction({
					id: 'generate',
					title: 'Generate a design',
					run: (argument) => {
						const parsed = parseSlashArgument(argument);
						return void generate.generate(parsed.description, parsed.template);
					}
				}),
			'chat action /generate'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-generate/status',
					region: 'canvas-overlay',
					component: GenerateStatus
				}),
			'ai generate status'
		);
		ctx.effect(() => () => void generate.cancel(), 'ai-generate/cancel on unload');
	}
};
