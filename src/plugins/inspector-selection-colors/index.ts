import type { Context } from '@neoworks/extension-system';
import SelectionColorsSection from './SelectionColorsSection.svelte';

// Every solid color used below the selection (fills, strokes, text), with bulk replacement as one
// undo step. Rows show the variable or style name when the color is bound.
export default {
	name: 'inspector-selection-colors',
	inject: ['inspectors', 'document', 'selection', 'variables'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'selection-colors',
					tab: 'design',
					title: 'Selection colors',
					order: 80,
					applies: (selection) => selection.count > 0,
					component: SelectionColorsSection
				}),
			'selection colors section'
		);
	}
};
