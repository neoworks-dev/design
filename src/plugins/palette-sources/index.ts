import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import type { PaletteItem } from '../command-palette/service';

const MAX_LAYER_CANDIDATES = 200;

function matchesText(query: string, name: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	return name.toLowerCase().includes(needle);
}

// Pages and layers (by name) as palette sources. A page switches to it; a layer switches to its
// page, selects it and zooms to it.
export default {
	name: 'palette-sources',
	inject: ['palette', 'document', 'selection', 'viewport'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: 'pages',
					title: 'Pages',
					order: 10,
					placeholder: 'Go to a page',
					items: () =>
						ctx.document.pages().map((page): PaletteItem => ({
							id: page.id,
							title: page.name,
							run: () => ctx.document.setCurrentPage(page.id)
						}))
				}),
			'palette source pages'
		);

		const goToLayer = (id: NodeId): void => {
			ctx.document.setCurrentPage(ctx.document.pageOf(id).id);
			ctx.selection.select([id], 'replace', { source: 'canvas' });
			ctx.viewport.zoomToSelection();
		};

		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: 'layers',
					title: 'Layers',
					order: 20,
					placeholder: 'Find a layer by name',
					items: (query) =>
						ctx.document
							.query((node) => node.type !== 'PAGE' && matchesText(query, node.name))
							.slice(0, MAX_LAYER_CANDIDATES)
							.map((node): PaletteItem => ({
								id: node.id,
								title: node.name,
								subtitle: node.type.toLowerCase().replaceAll('_', ' '),
								run: () => goToLayer(node.id)
							}))
				}),
			'palette source layers'
		);
	}
};
