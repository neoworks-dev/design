import type { CommandsService } from '../../lib/registries/commands.svelte';
import type { KeymapService } from '../../lib/registries/keymap.svelte';
import {
	COMMANDS_SOURCE_ID,
	type PaletteItem,
	type PaletteService,
	type PaletteSource
} from './service';

function itemOf(
	commands: CommandsService,
	keymap: KeymapService,
	command: { id: string; title: string }
): PaletteItem {
	return {
		id: command.id,
		commandId: command.id,
		title: command.title,
		subtitle: command.id,
		accelerator: keymap.lookup(command.id),
		enabled: commands.isEnabled(command.id),
		run: () => commands.run(command.id)
	};
}

/** Recently run commands first, then the rest in registration order. */
function recentFirst(items: PaletteItem[], recent: readonly string[]): PaletteItem[] {
	const recentItems: PaletteItem[] = [];
	for (const id of recent) {
		const item = items.find((candidate) => candidate.id === id);
		if (item) recentItems.push(item);
	}
	return [...recentItems, ...items.filter((item) => !recent.includes(item.id))];
}

/** Every registered command; commands whose `when` fails stay listed but disabled. */
export function createCommandsSource(
	palette: PaletteService,
	commands: CommandsService,
	keymap: KeymapService
): PaletteSource {
	return {
		id: COMMANDS_SOURCE_ID,
		title: 'Commands',
		order: 0,
		placeholder: 'Type a command',
		items: (query) => {
			const items = commands.list().map((command) => itemOf(commands, keymap, command));
			if (query.trim() !== '') return items;
			return recentFirst(items, palette.recentCommands());
		}
	};
}
