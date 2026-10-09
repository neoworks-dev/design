import type { Context } from '@neoworks/extension-system';
import SizeSection from './SizeSection.svelte';

// The Layout section: auto layout mode, width and height with the proportion lock, Fixed / Hug /
// Fill, min and max, auto layout alignment, spacing and padding (while it is on), constraints and
// clip content. Every auto layout control writes ordinary properties and the `autolayout` plugin
// reflows in the same transaction, so each edit is one undo step.
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
