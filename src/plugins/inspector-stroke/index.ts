import type { Context } from '@neoworks/extension-system';
import { planSetProps, type Change } from '../../lib/document';
import { applyEdit, contributeCommand } from '../../lib/editing/contribute';
import { listsAreEmpty } from '../../lib/inspector-inputs/selectionEdit';
import StrokeSection from './StrokeSection.svelte';
import StrokeActions from './StrokeActions.svelte';

const NO_STROKE_KINDS = ['GROUP', 'TEXT', 'SLICE', 'PAGE'];

function removeStrokes(ctx: Context): void {
	const changes: Change[] = [];
	for (const id of ctx.selection.ids) {
		const node = ctx.document.reader.requireNode(id);
		if (!('strokes' in node) || node.strokes.length === 0) continue;
		changes.push(...planSetProps(ctx.document.reader, id, { strokes: [] }));
	}
	applyEdit(ctx, changes, 'Remove stroke');
}

// The Stroke section of the Design tab: the first stroke's paint list, weight (or per-side
// weights), position and the advanced popover (dash, ends, join).
export default {
	name: 'inspector-stroke',
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
					id: 'stroke',
					tab: 'design',
					title: 'Stroke',
					order: 50,
					applies: (selection) =>
						selection.count > 0 && selection.kinds.every((kind) => !NO_STROKE_KINDS.includes(kind)),
					component: StrokeSection,
					empty: () => listsAreEmpty(ctx, 'strokes'),
					actions: StrokeActions
				}),
			'stroke section'
		);
		contributeCommand(ctx, {
			id: 'stroke.remove',
			title: 'Remove stroke',
			when: 'hasSelection',
			run: () => removeStrokes(ctx),
			keys: ['Shift+/']
		});
	}
};
