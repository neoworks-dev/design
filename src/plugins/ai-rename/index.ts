import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { PROMPT_SUGGESTIONS_MENU } from '../../lib/ai/selectionPrompt';
import { contributeCommand } from '../../lib/editing/contribute';
import { AiRenameService } from '../../lib/services/aiRename';
import { AiRenameState } from '../../lib/services/aiRenameState.svelte';
import RenameToast from './RenameToast.svelte';

const aiRenameConfigSchema = z
	.object({
		showSuggestion: z
			.boolean()
			.default(true)
			.describe('Offer "Missing N layer names, Rename layers" when a frame is selected.')
	})
	.prefault({});
type AiRenameConfig = z.infer<typeof aiRenameConfigSchema>;

const renameLayersInput = z.strictObject({
	names: z
		.array(z.strictObject({ id: z.string(), name: z.string() }))
		.min(1)
		.describe('The new name of each layer')
});

const ACTIONS_MENU = 'context/actions';
const MENUS_WITH_ACTIONS = ['context/canvas', 'context/layer', 'context/layer-panel'];

// Rename layers with AI (#149): command `ai-rename.run` ("Rename layers with AI"), the context
// menu entry Actions > Rename layers and a hint when a frame with default names is selected. The
// model answers through the `rename_layers` tool, which only renames the default-named layers the
// run was started for (hidden, locked, instance and vector layers are never offered).
// Owns the `context/actions` submenu entry; other AI actions put their items in that menu.
export default {
	name: 'ai-rename',
	inject: ['ai', 'selection', 'document', 'commands', 'menus', 'regions', 'panels'],
	Config: aiRenameConfigSchema,
	apply(ctx: Context, config: AiRenameConfig): void {
		const rename = new AiRenameService(
			ctx,
			ctx.ai,
			ctx.document,
			ctx.selection,
			new AiRenameState(),
			() => ctx.panels.activateTab('ai-chat'),
			config.showSuggestion
		);

		const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(renameLayersInput) };
		delete inputSchema.$schema;
		ctx.effect(
			() =>
				ctx.ai.registerTool({
					id: 'rename_layers',
					description:
						'Rename layers. Only the layers a rename task listed, and only while they still have their default name.',
					write: true,
					taskOnly: true,
					inputSchema,
					run: (input, run) => {
						const parsed = renameLayersInput.parse(input);
						return JSON.stringify(rename.applyNames(run, parsed.names));
					}
				}),
			'ai tool rename_layers'
		);

		contributeCommand(ctx, {
			id: 'ai-rename.run',
			title: 'Rename layers with AI',
			when: 'hasSelection',
			run: () => rename.renameLayers(),
			menus: [
				{ menu: ACTIONS_MENU, group: '1_rename', order: 1 },
				{ menu: PROMPT_SUGGESTIONS_MENU, group: '1_suggestions', order: 1 }
			]
		});
		for (const menu of MENUS_WITH_ACTIONS) {
			ctx.effect(
				() =>
					ctx.menus.register({
						menu,
						item: {
							id: 'actions',
							title: 'Actions',
							submenu: ACTIONS_MENU,
							group: '7_actions',
							when: 'hasSelection'
						}
					}),
				`menu ${menu} actions submenu`
			);
		}

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'ai-rename/toast',
					region: 'canvas-overlay',
					component: RenameToast
				}),
			'ai rename toast'
		);
	}
};
