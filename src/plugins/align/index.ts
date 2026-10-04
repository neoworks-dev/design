import type { Context } from '@neoworks/extension-system';
import type { Change, NodeId } from '../../lib/document';
import {
	planAlign,
	planDistribute,
	planTidyUp,
	type AlignEdge,
	type DistributeAxis
} from '../../lib/editing/align';
import { applyEdit, contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';

interface AlignCommand {
	edge: AlignEdge;
	title: string;
	key: string;
}

const ALIGN_COMMANDS: AlignCommand[] = [
	{ edge: 'left', title: 'Align left', key: 'Alt+A' },
	{ edge: 'horizontal-center', title: 'Align horizontal centers', key: 'Alt+H' },
	{ edge: 'right', title: 'Align right', key: 'Alt+D' },
	{ edge: 'top', title: 'Align top', key: 'Alt+W' },
	{ edge: 'vertical-center', title: 'Align vertical centers', key: 'Alt+V' },
	{ edge: 'bottom', title: 'Align bottom', key: 'Alt+S' }
];

interface DistributeCommand {
	axis: DistributeAxis;
	title: string;
	key: string;
}

const DISTRIBUTE_COMMANDS: DistributeCommand[] = [
	{ axis: 'horizontal', title: 'Distribute horizontal spacing', key: 'Alt+Shift+H' },
	{ axis: 'vertical', title: 'Distribute vertical spacing', key: 'Alt+Shift+V' }
];

function menus(order: number): MenuPlacement[] {
	return [
		{ menu: 'context/canvas', group: '2_align', order },
		{ menu: 'context/layer', group: '2_align', order }
	];
}

function edit(ctx: Context, plan: (ids: readonly NodeId[]) => Change[], label: string): void {
	applyEdit(ctx, plan(ctx.selection.ids), label);
}

// Align (to the parent frame for one node, to the selection bounds for several), distribute
// spacing for three or more nodes and tidy up. Each command is one undo step.
export default {
	name: 'align',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		ALIGN_COMMANDS.forEach((command, position) => {
			contributeCommand(ctx, {
				id: `align.${command.edge}`,
				title: command.title,
				when: 'hasSelection',
				run: () =>
					edit(ctx, (ids) => planAlign(ctx.document.reader, ids, command.edge), command.title),
				keys: [command.key],
				menus: menus(position)
			});
		});
		DISTRIBUTE_COMMANDS.forEach((command, position) => {
			contributeCommand(ctx, {
				id: `align.distribute-${command.axis}`,
				title: command.title,
				when: 'hasSelection',
				run: () =>
					edit(ctx, (ids) => planDistribute(ctx.document.reader, ids, command.axis), command.title),
				keys: [command.key],
				menus: menus(ALIGN_COMMANDS.length + position)
			});
		});
		contributeCommand(ctx, {
			id: 'align.tidy-up',
			title: 'Tidy up',
			when: 'hasSelection',
			run: () => edit(ctx, (ids) => planTidyUp(ctx.document.reader, ids), 'Tidy up'),
			keys: ['Mod+Alt+Shift+T'],
			menus: menus(ALIGN_COMMANDS.length + DISTRIBUTE_COMMANDS.length)
		});
	}
};
