import type { Context } from '@neoworks/extension-system';
import type { PaletteItem } from '../command-palette/service';

const SOURCE_ID = 'resources';

// The Resources quick search (Shift+I): the command palette opened on a "Resources" tab that
// lists the components of the file; Enter inserts the highlighted one at the middle of the
// selected frame, else of the viewport (the same insert as a double click in the assets panel).
// Other plugins can add their own resources by registering palette sources: this one only owns
// the components. Inserting a component into itself is refused and greyed out, as in the panel.
export default {
	name: 'resources-search',
	inject: ['palette', 'assetsPanel', 'commands', 'keymap'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.palette.registerSource({
					id: SOURCE_ID,
					title: 'Resources',
					order: 15,
					placeholder: 'Insert a component',
					items: () =>
						ctx.assetsPanel.searchComponents('').map((entry): PaletteItem => ({
							id: entry.id,
							title: entry.name,
							subtitle: entry.group,
							enabled: !entry.blocked,
							run: () => void ctx.assetsPanel.insertAtDefault(entry.id)
						}))
				}),
			'palette source resources'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'resources.search',
					title: 'Search resources',
					run: () => ctx.palette.open(SOURCE_ID)
				}),
			'command resources.search'
		);
		ctx.effect(
			() =>
				ctx.keymap.register({
					key: 'Shift+I',
					command: 'resources.search',
					scope: 'global',
					source: 'resources-search'
				}),
			'shortcut Shift+I resources search'
		);
	}
};
