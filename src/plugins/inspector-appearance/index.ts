import type { Context } from '@neoworks/extension-system';
import AppearanceActions from './AppearanceActions.svelte';
import AppearanceSection from './AppearanceSection.svelte';

// Opacity, corner radius (independent corners and smoothing on demand) in the body; visibility and
// blend mode in the header. Opacity and visibility go through the `node.*` commands; the mask
// toggle lives in the Design header (design-panel).
export default {
	name: 'inspector-appearance',
	inject: ['inspectors', 'document', 'selection', 'variables', 'commands'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'appearance',
					tab: 'design',
					title: 'Appearance',
					order: 30,
					applies: (selection) => selection.count > 0,
					component: AppearanceSection,
					actions: AppearanceActions
				}),
			'appearance section'
		);
	}
};
