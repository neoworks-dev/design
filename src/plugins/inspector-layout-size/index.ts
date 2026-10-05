import type { Context } from '@neoworks/extension-system';
import SizeSection from './SizeSection.svelte';

// Width and height with the proportion lock, Fixed / Hug / Fill, min and max, clip content and
// constraints. Hug and Fill are stored properties until the auto layout engine exists.
export default {
	name: 'inspector-layout-size',
	inject: ['inspectors', 'document', 'selection', 'variables'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'layout-size',
					tab: 'design',
					title: 'Layout',
					order: 20,
					applies: (selection) => selection.count > 0,
					component: SizeSection
				}),
			'layout size section'
		);
	}
};
