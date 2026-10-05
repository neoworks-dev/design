import type { Context } from '@neoworks/extension-system';
import EffectsSection from './EffectsSection.svelte';

// Node types that carry `effects` (everything but pages, sections and slices).
const NO_EFFECT_KINDS = ['PAGE', 'SECTION', 'SLICE'];

// The Effects section of the Design tab: drop and inner shadows, layer and background blur,
// each with visibility, a settings popover and drag reordering.
export default {
	name: 'inspector-effects',
	inject: ['inspectors', 'document', 'selection', 'variables', 'colorPicker', 'styles'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'effects',
					tab: 'design',
					title: 'Effects',
					order: 60,
					applies: (selection) =>
						selection.count > 0 && selection.kinds.every((kind) => !NO_EFFECT_KINDS.includes(kind)),
					component: EffectsSection
				}),
			'effects section'
		);
	}
};
