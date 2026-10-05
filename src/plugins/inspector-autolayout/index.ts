import type { Context } from '@neoworks/extension-system';
import AutoLayoutSection from './AutoLayoutSection.svelte';

const FRAME_KINDS = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

// The Auto layout section of the Design tab, right below Layout (size): Flow buttons (freeform,
// vertical, horizontal, wrap), the 3 x 3 alignment grid, spacing with "auto", padding (uniform or
// per side), strokes in layout, and absolute positioning for children of an auto layout frame.
// Every control writes ordinary properties; the `autolayout` plugin reflows in the same
// transaction, so each edit is one undo step.
export default {
	name: 'inspector-autolayout',
	inject: ['inspectors', 'autolayout', 'document', 'selection', 'variables'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'autolayout',
					tab: 'design',
					title: 'Auto layout',
					order: 25,
					applies: (selection) => {
						if (selection.count === 0) return false;
						if (selection.kinds.every((kind) => FRAME_KINDS.includes(kind))) return true;
						if (selection.parentId === null || !ctx.document.has(selection.parentId)) return false;
						const parent = ctx.document.require(selection.parentId);
						return 'layoutMode' in parent && parent.layoutMode !== 'NONE';
					},
					component: AutoLayoutSection
				}),
			'auto layout section'
		);
	}
};
