import type { Context } from '@neoworks/extension-system';
import AppearanceSection from './AppearanceSection.svelte';

// Opacity, blend mode, visibility, mask, corner radius and smoothing. Opacity, visibility and
// mask go through the existing `node.*` and `mask.*` commands.
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
					component: AppearanceSection
				}),
			'appearance section'
		);
	}
};
