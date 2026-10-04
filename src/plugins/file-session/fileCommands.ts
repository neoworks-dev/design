// Commands and shortcuts of the file session: file.new, file.open, file.save, file.saveAs. They
// work even while a text field has focus (a save should never be swallowed by a text input).
// `file.open` and `file.saveAs` take an optional `{ path }` so a menu entry, a recent file, a
// drop or a test can skip the dialog.

import type { Context } from '@neoworks/extension-system';
import type { FileSessionService } from '../../lib/services/fileSession';

function pathArgument(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const path: unknown = Reflect.get(args, 'path');
	if (typeof path === 'string') return path;
	return undefined;
}

export function registerFileCommands(ctx: Context, session: FileSessionService): void {
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.new',
				title: 'New file',
				run: async () => {
					await session.newDocument();
				}
			}),
		'command file.new'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.open',
				title: 'Open...',
				run: async (args) => {
					await session.openDocument(pathArgument(args));
				}
			}),
		'command file.open'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.save',
				title: 'Save',
				run: async () => {
					await session.save();
				}
			}),
		'command file.save'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.saveAs',
				title: 'Save as...',
				run: async (args) => {
					await session.saveAs(pathArgument(args));
				}
			}),
		'command file.saveAs'
	);

	const bindings: [string, string][] = [
		['Mod+N', 'file.new'],
		['Mod+O', 'file.open'],
		['Mod+S', 'file.save'],
		['Mod+Shift+S', 'file.saveAs']
	];
	for (const [key, command] of bindings) {
		ctx.effect(
			() => ctx.keymap.register({ key, command, scope: 'global', allowInEditable: true }),
			`keymap ${command}`
		);
	}
}
