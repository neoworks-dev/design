import type { Context } from '@neoworks/extension-system';
import { addVariant, combineAsVariants } from '../../lib/components/variants';
import { contributeCommand } from '../../lib/editing/contribute';
import InstanceVariantSection from './InstanceVariantSection.svelte';
import SetSection from './SetSection.svelte';
import VariantChips from './VariantChips.svelte';
import VariantSection from './VariantSection.svelte';

const SELECTION_MENUS = ['context/canvas', 'context/layer'];

function placements(order: number): { menu: string; group: string; order: number }[] {
	return SELECTION_MENUS.map((menu) => ({ menu, group: '3_component', order }));
}

// Component sets and variants: Combine as variants (Ctrl+Alt+Shift+K), the "N Variants" chip with
// a plus above every set, Add variant, and the Design sections for a set (its variant
// properties), a variant (its values) and an instance of a variant (a dropdown per property that
// switches the instance, keeping its overrides by name path).
export default {
	name: 'variants',
	inject: [
		'componentSync',
		'document',
		'selection',
		'commands',
		'keymap',
		'menus',
		'contextKeys',
		'inspectors',
		'regions',
		'viewport'
	],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'variants/chips',
					region: 'canvas-overlay',
					component: VariantChips
				}),
			'variants/chips overlay'
		);

		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'variant-set',
					tab: 'design',
					title: 'Variant properties',
					order: 6,
					applies: (selection) => selection.count === 1 && selection.kind === 'COMPONENT_SET',
					component: SetSection
				}),
			'variants/set section'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'variant',
					tab: 'design',
					title: 'Variant',
					order: 6,
					applies: (selection) => {
						if (selection.count !== 1 || selection.kind !== 'COMPONENT') return false;
						return ctx.componentSync.variantSetOf(ctx.selection.ids[0]) !== undefined;
					},
					component: VariantSection
				}),
			'variants/variant section'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'instance-variants',
					tab: 'design',
					title: 'Variant',
					order: 6,
					applies: (selection) => {
						if (selection.count !== 1 || selection.kind !== 'INSTANCE') return false;
						const node = ctx.selection.nodes()[0];
						if (node === undefined || node.type !== 'INSTANCE') return false;
						return ctx.componentSync.variantSetOf(node.mainComponentId) !== undefined;
					},
					component: InstanceVariantSection
				}),
			'variants/instance section'
		);

		contributeCommand(ctx, {
			id: 'variants.combine',
			title: 'Combine as variants',
			when: 'canCreateComponent || selectionHasMain',
			run: () => combineAsVariants(ctx),
			keys: ['Mod+Alt+Shift+K'],
			menus: placements(7)
		});
		contributeCommand(ctx, {
			id: 'variants.add',
			title: 'Add variant',
			when: 'selectionHasVariants',
			run: () => addVariant(ctx),
			menus: placements(8)
		});
	}
};
