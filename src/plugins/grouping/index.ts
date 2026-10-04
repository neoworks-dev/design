import type { Context } from '@neoworks/extension-system';
import { generateNodeId } from '../../lib/document';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import { planUngroup, planWrap, type WrapperKind } from '../../lib/editing/grouping';

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '3_group' },
	{ menu: 'context/layer', group: '3_group' }
];

function wrapSelection(ctx: Context, kind: WrapperKind, label: string): void {
	const plan = planWrap(ctx.document.reader, ctx.selection.ids, kind, generateNodeId());
	if (plan === null) return;
	if (!applyEdit(ctx, plan.changes, label)) return;
	ctx.selection.select([plan.wrapperId]);
}

function ungroupSelection(ctx: Context): void {
	const plan = planUngroup(ctx.document.reader, ctx.selection.ids);
	if (!applyEdit(ctx, plan.changes, 'Ungroup')) return;
	ctx.selection.select(plan.liftedIds);
}

// Group, frame selection and ungroup. Each is one undo step and keeps absolute positions; the
// selection afterwards is the new wrapper or the lifted nodes.
export default {
	name: 'grouping',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		contributeCommand(ctx, {
			id: 'grouping.group',
			title: 'Group selection',
			when: 'hasSelection',
			run: () => wrapSelection(ctx, 'GROUP', 'Group selection'),
			keys: ['Mod+G'],
			menus: MENUS.map((placement) => ({ ...placement, order: 0 }))
		});
		contributeCommand(ctx, {
			id: 'grouping.frame-selection',
			title: 'Frame selection',
			when: 'hasSelection',
			run: () => wrapSelection(ctx, 'FRAME', 'Frame selection'),
			keys: ['Mod+Alt+G'],
			menus: MENUS.map((placement) => ({ ...placement, order: 1 }))
		});
		contributeCommand(ctx, {
			id: 'grouping.ungroup',
			title: 'Ungroup',
			when: 'hasSelection',
			run: () => ungroupSelection(ctx),
			keys: ['Mod+Shift+G', 'Mod+Delete'],
			menus: MENUS.map((placement) => ({ ...placement, order: 2 }))
		});
	}
};
