import type { Context } from '@neoworks/extension-system';
import { DocumentSceneSource } from './source';

// Feeds the live document (current page, variables resolved) to the renderer as its SceneSource,
// and tells the viewport where the selection is. The renderer knows nothing about the document
// service; this adapter is the only place that connects them (see src/lib/renderer/sceneSource.ts).
export default {
	name: 'document-scene',
	inject: ['renderer', 'document', 'variables'],
	apply(ctx: Context): void {
		const source = new DocumentSceneSource(ctx.document, ctx.variables);

		ctx.on('document/change', (event) =>
			source.notify({ kind: 'changes', changes: event.transaction.changes })
		);
		ctx.on('document/replace', () => source.notify({ kind: 'reset' }));
		ctx.on('document/currentpagechange', () => source.notify({ kind: 'reset' }));

		ctx.effect(() => ctx.renderer.setSceneSource(source), 'document-scene/scene source');

		ctx.inject(['viewport', 'selection'], (scoped) => {
			scoped.effect(
				() => scoped.viewport.setSelectionProvider(() => scoped.selection.ids),
				'document-scene/selection provider'
			);
		});
	}
};
