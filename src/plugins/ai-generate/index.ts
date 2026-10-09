import type { Context } from '@neoworks/extension-system';
import { templateById, TEMPLATES, type TemplateId } from '../../lib/ai/generate';
import { PROMPT_SUGGESTIONS_MENU } from '../../lib/ai/selectionPrompt';
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
// chat. The model writes the design as HTML with the general `write` tool: flexbox becomes auto
// layout, data-component places instances of the file's components, var() binds its variables;
// it lands beside the existing frames. One AI run, one undo step; stopping a run takes back what
// it built.
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
		'menus',
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

		ctx.on('ai/edit', (run, edit) => generate.recordEdit(run, edit));

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
				ctx.menus.register({
					menu: PROMPT_SUGGESTIONS_MENU,
					item: {
						id: 'ai-generate.open',
						command: 'ai-generate.open',
						group: '1_suggestions',
						order: 0
					}
				}),
			'prompt suggestion generate'
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
