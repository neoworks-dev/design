// Commands and context menu items of the home screen. The menus are keyed by target kind
// (`home-file`, `home-folder`, `home-linked`) in the menus registry, so another plugin can add to
// them; the commands act on the target the menu was opened for (`args`).

import type { Context } from '@neoworks/extension-system';
import type { LibraryFile, LibraryFolder, LibraryOverview } from '../../../electron/bridge';
import { objectArguments } from '../../lib/editing/contribute';
import { moveDestinations } from '../../lib/home/library';
import { contextMenuPath } from '../../lib/registries/menus.svelte';
import { FILE_MENU, FOLDER_MENU, LINKED_MENU, type HomeService } from '../../lib/services/home';

export const MOVE_MENU = 'context/home-move';

interface HomeCommand {
	id: string;
	title: string;
	run: (home: HomeService, args: Record<string, unknown>) => Promise<void> | void;
}

function pathOf(args: Record<string, unknown>): string {
	const path = args.path;
	if (typeof path === 'string') return path;
	return '';
}

function withFile(
	home: HomeService,
	args: Record<string, unknown>,
	run: (file: LibraryFile) => Promise<void> | void
): Promise<void> | void {
	const file = home.findFile(pathOf(args));
	if (file === undefined) return;
	return run(file);
}

function withFolder(
	home: HomeService,
	args: Record<string, unknown>,
	run: (folder: LibraryFolder) => Promise<void> | void
): Promise<void> | void {
	const folder = home.findFolder(pathOf(args));
	if (folder === undefined) return;
	return run(folder);
}

const COMMANDS: HomeCommand[] = [
	{
		id: 'home.file.open',
		title: 'Open',
		run: (home, args) => withFile(home, args, (file) => home.open(file))
	},
	{
		id: 'home.file.rename',
		title: 'Rename',
		run: (home, args) => home.beginRename(pathOf(args))
	},
	{
		id: 'home.file.duplicate',
		title: 'Duplicate',
		run: (home, args) => withFile(home, args, (file) => home.duplicateFile(file))
	},
	{
		id: 'home.file.moveTo',
		title: 'Move to',
		run: (home, args) => {
			const directory = args.directory;
			if (typeof directory !== 'string') return;
			return home.moveMenuFileTo(directory);
		}
	},
	{
		id: 'home.file.reveal',
		title: 'Show in folder',
		run: (home, args) => home.reveal(pathOf(args))
	},
	{
		id: 'home.file.removeRecent',
		title: 'Remove from recents',
		run: (home, args) => withFile(home, args, (file) => home.removeRecent(file))
	},
	{
		id: 'home.file.trash',
		title: 'Move to trash',
		run: (home, args) => withFile(home, args, (file) => home.requestTrashFile(file))
	},
	{
		id: 'home.folder.rename',
		title: 'Rename',
		run: (home, args) => home.beginRename(pathOf(args))
	},
	{
		id: 'home.folder.reveal',
		title: 'Show in folder',
		run: (home, args) => home.reveal(pathOf(args))
	},
	{
		id: 'home.folder.trash',
		title: 'Move to trash',
		run: (home, args) => withFolder(home, args, (folder) => home.requestTrashFolder(folder))
	},
	{
		id: 'home.linked.unlink',
		title: 'Unlink folder',
		run: (home, args) => {
			const linked = home.overview?.linked.find((candidate) => candidate.id === args.id);
			if (linked === undefined) return;
			return home.unlinkFolder(linked);
		}
	}
];

interface MenuItemSpec {
	menu: string;
	id: string;
	command: string;
	group: string;
	when?: string;
}

const ITEMS: MenuItemSpec[] = [
	{ menu: FILE_MENU, id: 'open', command: 'home.file.open', group: '1_open' },
	{ menu: FILE_MENU, id: 'rename', command: 'home.file.rename', group: '2_edit' },
	{ menu: FILE_MENU, id: 'duplicate', command: 'home.file.duplicate', group: '2_edit' },
	{ menu: FILE_MENU, id: 'reveal', command: 'home.file.reveal', group: '3_where' },
	{
		menu: FILE_MENU,
		id: 'remove-recent',
		command: 'home.file.removeRecent',
		group: '3_where',
		when: 'home.recents'
	},
	{ menu: FILE_MENU, id: 'trash', command: 'home.file.trash', group: '4_danger' },
	{ menu: FOLDER_MENU, id: 'rename', command: 'home.folder.rename', group: '1_edit' },
	{ menu: FOLDER_MENU, id: 'reveal', command: 'home.folder.reveal', group: '2_where' },
	{ menu: FOLDER_MENU, id: 'trash', command: 'home.folder.trash', group: '3_danger' },
	{ menu: LINKED_MENU, id: 'reveal', command: 'home.folder.reveal', group: '1_where' },
	{ menu: LINKED_MENU, id: 'unlink', command: 'home.linked.unlink', group: '2_unlink' }
];

export function registerHomeCommands(ctx: Context, home: HomeService): void {
	for (const command of COMMANDS) {
		ctx.effect(
			() =>
				ctx.commands.register({
					id: command.id,
					title: command.title,
					run: async (args) => {
						await command.run(home, objectArguments(args));
					}
				}),
			`command ${command.id}`
		);
	}
	for (const spec of ITEMS) {
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: contextMenuPath(spec.menu),
					item: { id: spec.id, command: spec.command, group: spec.group, when: spec.when }
				}),
			`menu ${spec.menu} ${spec.id}`
		);
	}
	ctx.effect(
		() =>
			ctx.menus.register({
				menu: contextMenuPath(FILE_MENU),
				item: {
					id: 'move-to',
					title: 'Move to',
					submenu: MOVE_MENU,
					group: '2_edit',
					order: 5
				}
			}),
		'menu home-file move-to'
	);
}

/**
 * Keeps the "Move to" submenu in step with the library: one item per destination, rebuilt
 * whenever the overview changes. `dispose` removes them all.
 */
export class MoveMenu {
	private disposers: (() => Promise<void>)[] = [];

	constructor(private readonly ctx: Context) {}

	rebuild(overview: LibraryOverview): void {
		this.dispose();
		moveDestinations(overview).forEach((destination, index) => {
			this.disposers.push(
				this.ctx.effect(
					() =>
						this.ctx.menus.register({
							menu: MOVE_MENU,
							item: {
								id: destination.directory,
								title: destination.label,
								command: 'home.file.moveTo',
								args: { directory: destination.directory },
								group: '1',
								order: index
							}
						}),
					`menu ${MOVE_MENU} ${destination.directory}`
				)
			);
		});
	}

	dispose(): void {
		const previous = this.disposers.splice(0);
		for (const remove of previous) void remove();
	}
}
