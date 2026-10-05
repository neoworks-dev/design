import type { Context } from '@neoworks/extension-system';
import { TabsService } from '../../lib/services/tabs';
import { TabsState } from '../../lib/services/tabsState.svelte';
import TabStrip from './TabStrip.svelte';

interface TabCommand {
	id: string;
	title: string;
	key: string;
	run: (tabs: TabsService) => Promise<void>;
}

const COMMANDS: TabCommand[] = [
	{ id: 'tabs.new', title: 'New tab', key: 'Mod+Alt+N', run: (tabs) => tabs.newTab() },
	{ id: 'tabs.close', title: 'Close tab', key: 'Mod+W', run: (tabs) => tabs.closeActive() },
	{ id: 'tabs.next', title: 'Next tab', key: 'Ctrl+Tab', run: (tabs) => tabs.cycle(1) },
	{
		id: 'tabs.previous',
		title: 'Previous tab',
		key: 'Ctrl+Shift+Tab',
		run: (tabs) => tabs.cycle(-1)
	},
	{
		id: 'tabs.reopen-closed',
		title: 'Reopen closed tab',
		key: 'Mod+Shift+T',
		run: (tabs) => tabs.reopenClosed()
	}
];

// Several documents in one window (#138). A tab strip in the `top-bar`, and File > New / Open
// open tabs through the `file/open-request` event. The strip switches the window's one live
// document (see lib/services/tabs.ts for why it is not one kernel context per document).
export default {
	name: 'tabs',
	inject: ['fileSession', 'document', 'selection', 'regions', 'commands', 'keymap', 'desktop'],
	apply(ctx: Context): void {
		const tabs = new TabsService(
			ctx,
			ctx.fileSession,
			ctx.document,
			ctx.selection,
			new TabsState()
		);

		const attached = ctx.fileSession.info;
		if (attached !== null) tabs.handleAttached(attached);
		ctx.on('file/attached', (info) => tabs.handleAttached(info));
		ctx.on('file/open-request', (request) => tabs.handleOpenRequest(request));

		for (const command of COMMANDS) {
			ctx.effect(
				() =>
					ctx.commands.register({
						id: command.id,
						title: command.title,
						run: () => command.run(tabs)
					}),
				`command ${command.id}`
			);
			ctx.effect(
				() => ctx.keymap.register({ key: command.key, command: command.id, scope: 'global' }),
				`shortcut ${command.key}`
			);
		}

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'tabs/strip',
					region: 'top-bar',
					component: TabStrip,
					order: -1
				}),
			'tabs strip'
		);
	}
};
