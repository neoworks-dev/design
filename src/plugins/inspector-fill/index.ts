import type { Context } from '@neoworks/extension-system';
import { planSetProps, type Change, type Node } from '../../lib/document';
import { applyEdit, contributeCommand } from '../../lib/editing/contribute';
import FillSection from './FillSection.svelte';
import FillActions from './FillActions.svelte';

// Node types whose `fills` the canvas paints from the node itself (text paints from its style).
const NO_FILL_KINDS = ['GROUP', 'TEXT', 'SLICE', 'PAGE'];

function removeTopFill(ctx: Context): void {
	const changes: Change[] = [];
	for (const id of ctx.selection.ids) {
		const node: Node = ctx.document.reader.requireNode(id);
		if (!('fills' in node) || node.fills.length === 0) continue;
		changes.push(...planSetProps(ctx.document.reader, id, { fills: node.fills.slice(0, -1) }));
	}
	applyEdit(ctx, changes, 'Remove fill');
}

// The Fill section of the Design tab: the paint list with type, visibility, opacity, variable
// binding and reordering. Colours and gradients open `colorPicker` and `gradientEditor`.
export default {
	name: 'inspector-fill',
	inject: [
		'inspectors',
		'document',
		'selection',
		'variables',
		'colorPicker',
		'gradientEditor',
		'commands',
		'keymap',
		'styles'
	],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'fill',
					tab: 'design',
					title: 'Fill',
					order: 40,
					applies: (selection) =>
						selection.count > 0 && selection.kinds.every((kind) => !NO_FILL_KINDS.includes(kind)),
					component: FillSection,
					actions: FillActions
				}),
			'fill section'
		);
		contributeCommand(ctx, {
			id: 'fill.remove',
			title: 'Remove fill',
			when: 'hasSelection',
			run: () => removeTopFill(ctx),
			keys: ['Alt+/']
		});
	}
};
