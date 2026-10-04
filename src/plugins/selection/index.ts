import type { Context } from '@neoworks/extension-system';
import { SelectionService } from '../../lib/services/selection';
import { SelectionState } from '../../lib/services/selectionState.svelte';
import { publishSelectionContextKeys } from './contextKeys';

// The `selection` service: selection set, scope, hover and per-page memory. It follows the
// document through events only (prune on change, swap on page change, reset on replace).
export default {
	name: 'selection',
	inject: ['document', 'contextKeys'],
	apply(ctx: Context): void {
		const selection = new SelectionService(ctx, ctx.document, new SelectionState());

		ctx.on('document/change', (event) => selection.handleDocumentChange(event));
		ctx.on('document/currentpagechange', (pageId, previousPageId) =>
			selection.handleCurrentPageChange(pageId, previousPageId)
		);
		ctx.on('document/replace', () => selection.handleDocumentReplace());

		publishSelectionContextKeys(ctx, selection);
	}
};
