import type { Context } from '@neoworks/extension-system';
import type { Rect } from '../../lib/document';
import {
	applyEdit,
	contributeCommand,
	followContent,
	type MenuPlacement
} from '../../lib/editing/contribute';
import {
	duplicableIds,
	planDuplicate,
	rememberDuplicate,
	repeatOffset,
	type DuplicateMemory
} from '../../lib/editing/duplicate';

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '1_edit', order: 3 },
	{ menu: 'context/layer', group: '1_edit', order: 3 }
];

function visibleRect(ctx: Context): Rect | null {
	const size = ctx.viewport.size;
	if (size.width <= 0 || size.height <= 0) return null;
	return ctx.viewport.visibleRect();
}

// Duplicate (Ctrl+D): copies land right after the originals, offset by 0 the first time and by the
// distance the previous duplicate was moved afterwards. One undo step; the copies are selected.
// The memory lives in this closure: it is not document state and dies with the plugin.
export default {
	name: 'duplicate',
	inject: ['document', 'selection', 'viewport', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		let memory: DuplicateMemory | null = null;
		contributeCommand(ctx, {
			id: 'duplicate.duplicate',
			title: 'Duplicate',
			when: 'hasSelection',
			run: () => {
				const reader = ctx.document.reader;
				const sourceIds = duplicableIds(reader, ctx.selection.ids);
				if (sourceIds.length === 0) return;
				const offset = repeatOffset(reader, memory, ctx.selection.ids);
				const plan = planDuplicate(reader, sourceIds, offset, visibleRect(ctx));
				const nextMemory = rememberDuplicate(reader, sourceIds, plan);
				if (!applyEdit(ctx, plan.changes, 'Duplicate')) return;
				memory = nextMemory;
				ctx.selection.select(plan.cloneIds);
				if (plan.placedBounds === null) return;
				const panMode = plan.moved ? 'just-enough' : 'overlap';
				followContent(ctx, plan.placedBounds, 'covers-safe-area', panMode);
			},
			keys: ['Mod+D'],
			menus: MENUS
		});
	}
};
