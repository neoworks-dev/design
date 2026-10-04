import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import {
	applyEdit,
	contributeCommand,
	objectArguments,
	type MenuPlacement
} from '../../lib/editing/contribute';
import {
	findNodes,
	planDelete,
	planFlip,
	planRename,
	planSetOpacity,
	planSwapFillAndStroke,
	planToggleLock,
	planToggleVisibility,
	type FlipAxis
} from '../../lib/editing/nodeCommands';

declare module '@neoworks/extension-system' {
	interface Events {
		/**
		 * Dispatch mode: emit. `node.find` ran without a query: the UI should open its find bar.
		 * Seam for the canvas/find UI; it then runs `node.find` with `{ query }`.
		 */
		'node-commands/find-request'(): void;
		/**
		 * Dispatch mode: emit. `node.rename` ran without a name: the UI should start inline
		 * renaming of `id` (the layers panel or a canvas label editor).
		 */
		'node-commands/rename-request'(id: NodeId): void;
	}
}

const CONTEXT_MENUS = ['context/canvas', 'context/layer'];

function menusIn(group: string, order: number): MenuPlacement[] {
	return CONTEXT_MENUS.map((menu) => ({ menu, group, order }));
}

function selectionIds(ctx: Context): readonly NodeId[] {
	return ctx.selection.ids;
}

function contributeFlip(ctx: Context, axis: FlipAxis, key: string): void {
	const title = axis === 'horizontal' ? 'Flip horizontal' : 'Flip vertical';
	contributeCommand(ctx, {
		id: `node.flip-${axis}`,
		title,
		when: 'hasSelection',
		run: () => applyEdit(ctx, planFlip(ctx.document.reader, selectionIds(ctx), axis), title),
		keys: [key],
		menus: menusIn('4_node', axis === 'horizontal' ? 0 : 1)
	});
}

function opacityFromArguments(args: unknown): number {
	const value = objectArguments(args).value;
	if (typeof value !== 'number') throw new TypeError('node.set-opacity needs { value: 0..1 }');
	return value;
}

function contributeOpacity(ctx: Context): void {
	contributeCommand(ctx, {
		id: 'node.set-opacity',
		title: 'Set opacity',
		when: 'hasSelection',
		run: (args) => {
			const changes = planSetOpacity(
				ctx.document.reader,
				selectionIds(ctx),
				opacityFromArguments(args)
			);
			applyEdit(ctx, changes, 'Set opacity', 'node-opacity');
		}
	});
	// Figma: 1 to 9 set 10% to 90%, 0 sets 100%.
	for (let digit = 0; digit <= 9; digit += 1) {
		const value = digit === 0 ? 1 : digit / 10;
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: String(digit),
					command: 'node.set-opacity',
					args: { value },
					scope: 'global',
					when: 'hasSelection'
				}),
			`keymap node.set-opacity ${digit}`
		);
	}
}

function runFind(ctx: Context, args: unknown): void {
	const query = objectArguments(args).query;
	if (typeof query !== 'string') {
		ctx.emit('node-commands/find-request');
		return;
	}
	const matches = findNodes(ctx.document.reader, ctx.document.currentPageId, query);
	ctx.selection.select(matches, 'replace', { source: 'api' });
}

function runRename(ctx: Context, args: unknown): void {
	const options = objectArguments(args);
	const id = typeof options.id === 'string' ? options.id : ctx.selection.primaryId;
	if (id === null) return;
	if (typeof options.name !== 'string') {
		ctx.emit('node-commands/rename-request', id);
		return;
	}
	applyEdit(ctx, planRename(ctx.document.reader, id, options.name), 'Rename');
}

// Small commands every editor expects. Each edit is one undo step through `document.apply`.
export default {
	name: 'node-commands',
	inject: ['document', 'selection', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		contributeFlip(ctx, 'horizontal', 'Shift+H');
		contributeFlip(ctx, 'vertical', 'Shift+V');
		contributeCommand(ctx, {
			id: 'node.toggle-visibility',
			title: 'Show/Hide',
			when: 'hasSelection',
			run: () =>
				applyEdit(ctx, planToggleVisibility(ctx.document.reader, selectionIds(ctx)), 'Show/Hide'),
			keys: ['Mod+Shift+H'],
			menus: menusIn('4_node', 2)
		});
		contributeCommand(ctx, {
			id: 'node.toggle-lock',
			title: 'Lock/Unlock',
			when: 'hasSelection',
			run: () =>
				applyEdit(ctx, planToggleLock(ctx.document.reader, selectionIds(ctx)), 'Lock/Unlock'),
			keys: ['Mod+Shift+L'],
			menus: menusIn('4_node', 3)
		});
		contributeCommand(ctx, {
			id: 'node.delete',
			title: 'Delete',
			when: 'hasSelection',
			run: () => applyEdit(ctx, planDelete(ctx.document.reader, selectionIds(ctx)), 'Delete'),
			keys: ['Delete', 'Backspace'],
			menus: menusIn('5_delete', 0)
		});
		contributeOpacity(ctx);
		contributeCommand(ctx, {
			id: 'node.swap-fill-stroke',
			title: 'Swap fill and stroke',
			when: 'hasSelection',
			run: () =>
				applyEdit(
					ctx,
					planSwapFillAndStroke(ctx.document.reader, selectionIds(ctx)),
					'Swap fill and stroke'
				),
			keys: ['Shift+X'],
			menus: menusIn('4_node', 4)
		});
		contributeCommand(ctx, {
			id: 'node.find',
			title: 'Find in page',
			run: (args) => runFind(ctx, args),
			keys: ['Mod+F'],
			scope: 'canvas'
		});
		contributeCommand(ctx, {
			id: 'node.rename',
			title: 'Rename',
			when: 'hasSelection',
			run: (args) => runRename(ctx, args),
			keys: ['Mod+R'],
			menus: menusIn('4_node', 5)
		});
	}
};
