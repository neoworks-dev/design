import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import { contributeCommand, type MenuPlacement } from '../../lib/editing/contribute';
import type { PasteMode } from '../../lib/editing/paste';
import { copySelection, cutSelection, pasteClipboard } from './flows';

declare module '@neoworks/extension-system' {
	interface Events {
		/**
		 * Dispatch mode: waterfall. Copy asks for a PNG of the copied nodes to put on the clipboard
		 * next to the design data. The headless export renderer answers it by transforming
		 * `next()`; without it the clipboard carries no image.
		 * Call as `ctx.waterfall('clipboard/render-png', ids, () => Promise.resolve(null))`.
		 */
		'clipboard/render-png'(
			ids: NodeId[],
			next: () => Promise<Uint8Array | null>
		): Promise<Uint8Array | null>;
	}
}

const EDIT_MENUS = ['context/canvas', 'context/layer'];

function selectionMenus(order: number): MenuPlacement[] {
	return EDIT_MENUS.map((menu) => ({ menu, group: '1_edit', order }));
}

function pasteMenus(order: number, passTarget = false): MenuPlacement[] {
	const menus = [...EDIT_MENUS, 'context/canvas-empty'];
	return menus.map((menu) => ({ menu, group: '1_edit', order, passTarget }));
}

interface PasteCommand {
	id: string;
	title: string;
	mode: PasteMode;
	keys: string[];
	order: number;
	/** Needs the cursor position the context menu was opened at. */
	passTarget?: boolean;
	/** Only offered while something is selected. */
	needsSelection?: boolean;
}

const PASTE_COMMANDS: PasteCommand[] = [
	{ id: 'clipboard.paste', title: 'Paste', mode: 'default', keys: ['Mod+V'], order: 2 },
	{
		id: 'clipboard.paste-here',
		title: 'Paste here',
		mode: 'here',
		keys: [],
		order: 4,
		passTarget: true
	},
	{ id: 'clipboard.paste-in-place', title: 'Paste in place', mode: 'in-place', keys: [], order: 5 },
	{
		id: 'clipboard.paste-over-selection',
		title: 'Paste over selection',
		mode: 'over-selection',
		keys: ['Mod+Shift+V'],
		order: 6
	},
	{
		id: 'clipboard.paste-replace',
		title: 'Paste to replace',
		mode: 'replace',
		keys: ['Mod+Shift+R'],
		order: 7,
		needsSelection: true
	}
];

function runAsync(ctx: Context, label: string, work: () => Promise<unknown>): void {
	work().catch((error: unknown) => ctx.logger.error(`${label} failed`, error));
}

// Copy, cut and the paste family. The design data travels on the OS clipboard through the main
// process (`ctx.desktop`), so it survives across windows and files; see clipboardPayload.ts for the
// format and paste.ts for the placement rules. Keys apply while the canvas has focus so text
// fields keep their own copy and paste.
export default {
	name: 'clipboard',
	inject: ['document', 'selection', 'desktop', 'blobs', 'viewport', 'commands', 'keymap', 'menus'],
	apply(ctx: Context): void {
		contributeCommand(ctx, {
			id: 'clipboard.copy',
			title: 'Copy',
			when: 'hasSelection',
			run: () => runAsync(ctx, 'copy', () => copySelection(ctx)),
			keys: ['Mod+C'],
			scope: 'canvas',
			menus: selectionMenus(0)
		});
		contributeCommand(ctx, {
			id: 'clipboard.cut',
			title: 'Cut',
			when: 'hasSelection',
			run: () => runAsync(ctx, 'cut', () => cutSelection(ctx)),
			keys: ['Mod+X'],
			scope: 'canvas',
			menus: selectionMenus(1)
		});
		for (const command of PASTE_COMMANDS) {
			contributeCommand(ctx, {
				id: command.id,
				title: command.title,
				when: command.needsSelection === true ? 'hasSelection' : undefined,
				run: (args) => runAsync(ctx, command.title, () => pasteClipboard(ctx, command.mode, args)),
				keys: command.keys,
				scope: 'canvas',
				menus: pasteMenus(command.order, command.passTarget === true)
			});
		}
	}
};
