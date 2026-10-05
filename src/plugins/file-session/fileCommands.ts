// Commands and shortcuts of the file session: file.new, file.open, file.save, file.saveAs,
// file.rename. Save only flushes the autosave queue; there is nothing to ask. They
// work even while a text field has focus (a save should never be swallowed by a text input).
// `file.new` takes an optional `{ directory }` (the home screen's current folder when it is
// showing), `file.rename` a `{ name }`; `file.open` and `file.saveAs` take an optional `{ path }` so a menu entry, a recent file, a
// drop or a test can skip the dialog.

import type { Context } from '@neoworks/extension-system';
import type { FileSessionService } from '../../lib/services/fileSession';

function pathArgument(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const path: unknown = Reflect.get(args, 'path');
	if (typeof path === 'string') return path;
	return undefined;
}

function stringArgument(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value: unknown = Reflect.get(args, key);
	if (typeof value === 'string') return value;
	return undefined;
}

/** The folder File > New creates in: asked for, else the one the home screen is showing. */
function newFileDirectory(ctx: Context, args: unknown): string | undefined {
	const requested = stringArgument(args, 'directory');
	if (requested !== undefined) return requested;
	const shown = ctx.contextKeys.get('home.directory');
	if (typeof shown === 'string' && shown.length > 0) return shown;
	return undefined;
}

export function registerFileCommands(ctx: Context, session: FileSessionService): void {
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.new',
				title: 'New file',
				run: async (args) => {
					await session.newDocument(newFileDirectory(ctx, args));
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
				id: 'file.rename',
				title: 'Rename file',
				run: async (args) => {
					const name = stringArgument(args, 'name');
					if (name !== undefined) {
						await session.rename(name);
						return;
					}
					if (ctx.commands.get('titlebar.rename') === undefined) return;
					await ctx.commands.run('titlebar.rename');
				}
			}),
		'command file.rename'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'file.saveAs',
				title: 'Save a copy as...',
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
