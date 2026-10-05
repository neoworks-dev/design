import type { Context } from '@neoworks/extension-system';
import PositionSection from './PositionSection.svelte';

// Alignment row, X / Y, rotation and flip. Alignment and flip delegate to the `align.*` and
// `node.flip-*` commands; the fields edit through `document.apply` (see inspector-inputs).
export default {
	name: 'inspector-position',
	inject: ['inspectors', 'document', 'selection', 'variables', 'commands'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'position',
					tab: 'design',
					title: 'Position',
					order: 10,
					applies: (selection) => selection.count > 0,
					component: PositionSection
				}),
			'position section'
		);
	}
};
