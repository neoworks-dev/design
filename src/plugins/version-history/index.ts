import type { Context } from '@neoworks/extension-system';
import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
import { VersionHistoryService } from '../../lib/services/versionHistory';
import { VersionHistoryState } from '../../lib/services/versionHistoryState.svelte';
import VersionHistoryPanel from './VersionHistoryPanel.svelte';

// Version history (#30): the "History" tab of the left sidebar lists the file's named and
// automatic versions and the logged changes (with origin badges). Restoring applies the undo of
// everything after a point as one undoable transaction. Provides `ctx.versionHistory`.
export default {
	name: 'version-history',
	inject: ['panels', 'desktop', 'fileSession', 'document', 'commands', 'menus'],
	apply(ctx: Context): void {
		const service = new VersionHistoryService(
			ctx,
			ctx.desktop,
			ctx.fileSession,
			ctx.document,
			new VersionHistoryState()
		);

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'version-history',
					side: 'left',
					title: 'History',
					icon: ClockCounterClockwiseIcon,
					order: 4,
					shortcut: 'Alt+H',
					component: VersionHistoryPanel
				}),
			'version history tab'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'version.showHistory',
					title: 'Show version history',
					run: () => ctx.panels.activateTab('version-history')
				}),
			'command version.showHistory'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'version.save',
					title: 'Save version...',
					run: async (args) => {
						if (typeof args === 'string') await service.saveVersion(args);
						else ctx.panels.activateTab('version-history');
					}
				}),
			'command version.save'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: { id: 'version.save', command: 'version.save', group: '7_versions', order: 1 }
				}),
			'menu app/file save version'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: {
						id: 'version.showHistory',
						command: 'version.showHistory',
						group: '7_versions',
						order: 2
					}
				}),
			'menu app/file version history'
		);
	}
};
