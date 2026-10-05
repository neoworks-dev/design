import type { Context } from '@neoworks/extension-system';
import { markTouched, planComponentAppend } from '../../lib/document';
import { ComponentSyncService } from '../../lib/services/componentSync';

// Keeps instances in sync with their main components (data-model.md section 2). Two document
// hooks, both skipped while history replays a transaction (the replayed changes already contain
// every derived change):
//   document/before-apply   user edits to an instance layer mark the touched property groups
//   document/append         a change to a main layer, or to an instance's component properties,
//                           appends the derived changes to the same transaction (one undo step)
// The `componentSync` service answers questions about components and instances.
export default {
	name: 'component-sync',
	inject: ['document'],
	apply(ctx: Context): void {
		new ComponentSyncService(ctx);

		ctx.on('document/before-apply', (changes, meta, next) => {
			const upstream = next();
			if (meta.replay !== undefined) return upstream;
			return markTouched(ctx.document.reader, upstream);
		});

		ctx.on('document/append', (request, next) => {
			const upstream = next();
			if (request.meta.replay !== undefined) return upstream;
			return [...upstream, ...planComponentAppend(ctx.document.reader, request.changes)];
		});
	}
};
