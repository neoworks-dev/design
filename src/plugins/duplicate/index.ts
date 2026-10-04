import type { Context } from '@neoworks/extension-system';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
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

// Duplicate (Ctrl+D): copies land right after the originals, offset by 0 the first time and by the
// distance the previous duplicate was moved afterwards. One undo step; the copies are selected.
// The memory lives in this closure: it is not document state and dies with the plugin.
export default {
	name: 'duplicate',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
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
				const plan = planDuplicate(reader, sourceIds, offset);
				const nextMemory = rememberDuplicate(reader, sourceIds, plan);
				if (!applyEdit(ctx, plan.changes, 'Duplicate')) return;
				memory = nextMemory;
				ctx.selection.select(plan.cloneIds);
			},
			keys: ['Mod+D'],
			menus: MENUS
		});
	}
};
