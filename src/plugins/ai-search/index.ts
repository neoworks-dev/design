import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import { AiSearchService, type SearchResult } from '../../lib/services/aiSearch';
import { AiSearchState } from '../../lib/services/aiSearchState.svelte';
import type { PaletteItem } from '../command-palette/service';

const SOURCE_ID = 'ai-search';

const reportMatchesInput = z.strictObject({
	ids: z.array(z.string()).max(15).describe('Ids of the matching candidates, best first'),
	note: z.string().optional().describe('One short sentence on how you decided')
});

function paletteItemOf(result: SearchResult, pick: (result: SearchResult) => void): PaletteItem {
	let subtitle = result.subtitle;
	if (result.fromAi) subtitle = `${subtitle} · AI`;
	return {
		id: `${result.kind}:${result.id}`,
		title: result.title,
		subtitle,
		run: () => pick(result)
	};
}

// Search across layers, components and styles by meaning (#150). A palette tab "AI Search"
// (command `ai-search.open`) answers from a local index that follows the document, and a last row
// "Ask the AI" re-ranks with the model (read-only run, `report_matches` tool). Picking selects and
// zooms to a layer or component, or shows a style in the Assets panel.
export default {
	name: 'ai-search',
	inject: [
		'ai',
		'document',
		'selection',
		'viewport',
		'palette',
		'commands',
		'panels',
		'assetsPanel'
	],
	apply(ctx: Context): void {
		const search = new AiSearchService(
			ctx,
			ctx.ai,
			ctx.document,
			ctx.selection,
			{
				zoomToSelection: () => ctx.viewport.zoomToSelection(),
				showStyleInAssets: (style) => {
					ctx.panels.activateTab('assets');
					ctx.assetsPanel.setQuery(style.name);
				},
				openChat: () => ctx.panels.activateTab('ai-chat')
			},
			new AiSearchState()
		);

		ctx.on('document/change', (event) => search.handleChange(event.affectedNodeIds));
		ctx.on('document/replace', () => search.handleDocumentReplace());

		const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(reportMatchesInput) };
		delete inputSchema.$schema;
		ctx.effect(
			() =>
				ctx.ai.registerTool({
					id: 'report_matches',
					description:
						'Report which candidates of a search task match the query, by id, best first.',
					write: false,
					taskOnly: true,
					inputSchema,
					run: (input, run) => {
						const parsed = reportMatchesInput.parse(input);
						const accepted = search.reportMatches(run.id, parsed.ids);
						return JSON.stringify({ accepted: accepted.length });
					}
				}),
			'ai tool report_matches'
		);

		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: SOURCE_ID,
					title: 'AI Search',
					order: 25,
					placeholder: 'Describe a layer, component or style',
					ranked: true,
					items: (query) =>
						search.search(query).map((result) => paletteItemOf(result, (r) => search.pick(r))),
					fallback: (query) => {
						if (!search.canAskAi) return undefined;
						return {
							id: 'ask-ai',
							title: `Ask the AI to find “${query.trim()}”`,
							subtitle: 'Ranks by meaning with the model',
							run: async () => {
								await search.askAi(query);
								ctx.palette.open(SOURCE_ID);
								ctx.palette.setQuery(query.trim());
							}
						};
					}
				}),
			'palette source ai-search'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'ai-search.open',
					title: 'Search layers, components and styles with AI',
					run: () => ctx.palette.open(SOURCE_ID)
				}),
			'command ai-search.open'
		);
	}
};
