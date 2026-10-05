import type { Context } from '@neoworks/extension-system';
import InstancePropertiesSection from './InstancePropertiesSection.svelte';
import LayerBindingsSection from './LayerBindingsSection.svelte';
import PropertiesSection from './PropertiesSection.svelte';

// Component properties: boolean, text and instance-swap properties defined on a main component
// (or its set), layers of the main bound to them, and the controls on an instance. Changing an
// instance's value updates the bound layers through the sync engine, in the same undo step.
// Variant properties are the `variants` plugin's.
export default {
	name: 'component-properties',
	inject: ['componentSync', 'document', 'selection', 'inspectors'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'component-properties',
					tab: 'design',
					title: 'Component properties',
					order: 7,
					applies: (selection) =>
						selection.count === 1 &&
						(selection.kind === 'COMPONENT' || selection.kind === 'COMPONENT_SET'),
					component: PropertiesSection
				}),
			'component-properties/definitions section'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'layer-bindings',
					tab: 'design',
					title: 'Layer properties',
					order: 7,
					applies: (selection) => {
						if (selection.count !== 1) return false;
						const node = ctx.selection.nodes()[0];
						if (node === undefined || node.componentRef !== undefined) return false;
						const main = ctx.componentSync.enclosingMainOf(node.id);
						return main !== undefined && main.id !== node.id;
					},
					component: LayerBindingsSection
				}),
			'component-properties/layer bindings section'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'instance-properties',
					tab: 'design',
					title: 'Properties',
					order: 7,
					applies: (selection) => {
						if (selection.count !== 1 || selection.kind !== 'INSTANCE') return false;
						const node = ctx.selection.nodes()[0];
						return node !== undefined && node.componentRef === undefined;
					},
					component: InstancePropertiesSection
				}),
			'component-properties/instance section'
		);
	}
};
