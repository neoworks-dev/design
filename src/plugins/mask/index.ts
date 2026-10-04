import type { Context } from '@neoworks/extension-system';
import { generateNodeId } from '../../lib/document';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import { planMaskToggle, planSetMaskType, type MaskType } from '../../lib/editing/mask';

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '3_group' },
	{ menu: 'context/layer', group: '3_group' }
];

const MASK_TYPES: Array<{ type: MaskType; title: string }> = [
	{ type: 'ALPHA', title: 'Mask type: alpha' },
	{ type: 'VECTOR', title: 'Mask type: vector' },
	{ type: 'LUMINANCE', title: 'Mask type: luminance' }
];

function toggleMask(ctx: Context): void {
	const plan = planMaskToggle(ctx.document.reader, ctx.selection.ids, generateNodeId());
	if (plan === null) return;
	if (!applyEdit(ctx, plan.changes, 'Use as mask')) return;
	ctx.selection.select(plan.selectIds);
}

function setMaskType(ctx: Context, maskType: MaskType): void {
	const changes = planSetMaskType(ctx.document.reader, ctx.selection.ids, maskType);
	applyEdit(ctx, changes, 'Change mask type');
}

// Use selection as mask (Ctrl+Alt+M, again to remove) and the mask type. One undo step each.
// Drawing masks is the renderer's job; the appearance-panel toggle is left to the inspectors.
export default {
	name: 'mask',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		contributeCommand(ctx, {
			id: 'mask.toggle',
			title: 'Use as mask',
			when: 'hasSelection',
			run: () => toggleMask(ctx),
			keys: ['Mod+Alt+M'],
			menus: MENUS.map((placement) => ({ ...placement, order: 3 }))
		});
		for (const { type, title } of MASK_TYPES) {
			contributeCommand(ctx, {
				id: `mask.type-${type.toLowerCase()}`,
				title,
				when: 'hasSelection',
				run: () => setMaskType(ctx, type)
			});
		}
	}
};
