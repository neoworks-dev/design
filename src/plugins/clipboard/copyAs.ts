// "Copy as" flows: SVG and CSS markup as plain text, and PNG through the headless export renderer.

import type { Context } from '@neoworks/extension-system';
import { copyableIds } from '../../lib/editing/clipboardPayload';
import { contributeCommand } from '../../lib/editing/contribute';
import { exportCss } from '../../lib/editing/css';
import { exportSvg } from '../../lib/editing/svg';

/** Put `text` on the clipboard when there is some; returns whether it did. */
async function writeText(ctx: Context, text: string | null): Promise<boolean> {
	if (text === null) return false;
	await ctx.desktop.clipboardWrite({ text });
	return true;
}

export function copyAsSvg(ctx: Context): Promise<boolean> {
	return writeText(ctx, exportSvg(ctx.document.reader, ctx.selection.ids));
}

export function copyAsCss(ctx: Context): Promise<boolean> {
	return writeText(ctx, exportCss(ctx.document.reader, ctx.selection.ids));
}

/**
 * Copy the selection as a PNG image. The picture comes from whoever answers the
 * `clipboard/render-png` waterfall (the headless export renderer, issue #44); until that plugin
 * exists nothing is copied and the reason is logged.
 */
export async function copyAsPng(ctx: Context): Promise<boolean> {
	const ids = copyableIds(ctx.document.reader, ctx.selection.ids);
	if (ids.length === 0) return false;
	const png = await ctx.waterfall('clipboard/render-png', ids, () => Promise.resolve(null));
	if (png === null) {
		ctx.logger.warn('copy as PNG needs the headless export renderer, which is not installed');
		return false;
	}
	await ctx.desktop.clipboardWrite({ png });
	return true;
}

const COPY_AS_MENU = 'context/copy-as';
const PARENT_MENUS = ['context/canvas', 'context/layer'];

interface CopyAsCommand {
	id: string;
	title: string;
	run: (ctx: Context) => Promise<boolean>;
	keys: string[];
}

const COPY_AS_COMMANDS: CopyAsCommand[] = [
	{ id: 'clipboard.copy-as-png', title: 'Copy as PNG', run: copyAsPng, keys: ['Mod+Shift+C'] },
	{ id: 'clipboard.copy-as-svg', title: 'Copy as SVG', run: copyAsSvg, keys: [] },
	{ id: 'clipboard.copy-as-css', title: 'Copy as CSS', run: copyAsCss, keys: [] }
];

function runLogged(ctx: Context, label: string, work: () => Promise<unknown>): void {
	work().catch((error: unknown) => ctx.logger.error(`${label} failed`, error));
}

/** Commands, keys and the "Copy/Paste as" submenu of the context menus. */
export function contributeCopyAs(ctx: Context): void {
	COPY_AS_COMMANDS.forEach((command, position) => {
		contributeCommand(ctx, {
			id: command.id,
			title: command.title,
			when: 'hasSelection',
			run: () => runLogged(ctx, command.title, () => command.run(ctx)),
			keys: command.keys,
			scope: 'canvas',
			menus: [{ menu: COPY_AS_MENU, group: '1_copy-as', order: position }]
		});
	});
	for (const menu of PARENT_MENUS) {
		ctx.effect(
			() =>
				ctx.menus.register({
					menu,
					item: {
						id: 'clipboard.copy-as',
						title: 'Copy/Paste as',
						submenu: COPY_AS_MENU,
						group: '1_edit',
						order: 8,
						when: 'hasSelection'
					}
				}),
			`menu ${menu} copy-as submenu`
		);
	}
}
