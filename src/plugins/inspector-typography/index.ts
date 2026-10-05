import type { Context } from '@neoworks/extension-system';
import TypographySection from './TypographySection.svelte';

// Typography for text nodes and the active edit range. Edits go through `ctx.textFormat`, which
// applies them to the edited range while a text is open and to whole nodes otherwise; node level
// settings (resize, vertical alignment, truncation) go through the one document path.
export default {
	name: 'inspector-typography',
	inject: ['inspectors', 'document', 'selection', 'variables', 'fonts', 'textFormat'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'typography',
					tab: 'design',
					title: 'Typography',
					order: 35,
					applies: (selection) => selection.hasText,
					component: TypographySection
				}),
			'typography section'
		);
	}
};
