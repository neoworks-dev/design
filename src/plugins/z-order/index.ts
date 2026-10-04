import type { Context } from '@neoworks/extension-system';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import { planZOrder, type ZOrderAction } from '../../lib/editing/zOrder';

interface ZOrderCommand {
	action: ZOrderAction;
	title: string;
	key: string;
}

const COMMANDS: ZOrderCommand[] = [
	{ action: 'front', title: 'Bring to front', key: ']' },
	{ action: 'forward', title: 'Bring forward', key: 'Mod+]' },
	{ action: 'backward', title: 'Send backward', key: 'Mod+[' },
	{ action: 'back', title: 'Send to back', key: '[' }
];

const MENUS: MenuPlacement[] = [
	{ menu: 'context/canvas', group: '2_arrange' },
	{ menu: 'context/layer', group: '2_arrange' }
];

// Stacking commands. Stacking is the sibling order, so each is a set of `move` changes within
// the selection's parents; auto layout children reorder in the layout the same way.
export default {
	name: 'z-order',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		COMMANDS.forEach((command, position) => {
			contributeCommand(ctx, {
				id: `z-order.${command.action}`,
				title: command.title,
				when: 'hasSelection',
				run: () => {
					const changes = planZOrder(ctx.document.reader, ctx.selection.ids, command.action);
					applyEdit(ctx, changes, command.title);
				},
				keys: [command.key],
				menus: MENUS.map((placement) => ({ ...placement, order: position }))
			});
		});
	}
};
