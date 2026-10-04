import type { Context } from '@neoworks/extension-system';
import { RecentFilesService, OPEN_RECENT_MENU } from '../../lib/services/recentFiles';
import { RecentFilesState } from '../../lib/services/recentFilesState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		recentFiles: RecentFilesService;
	}
}

// recent-files: the "Open Recent" submenu of the File menu, generated from the list main keeps.
// The list is read at mount and again whenever a file is attached (open, new, Save As).
// Thumbnails come with the list (`RecentFile.thumbnail`); writing them needs the renderer, which
// calls `ctx.desktop.filesSetThumbnail` when it can draw a preview (not wired yet).
export default {
	name: 'recent-files',
	inject: ['desktop', 'commands', 'menus'],
	apply(ctx: Context): void {
		const recent = new RecentFilesService(ctx, ctx.desktop, new RecentFilesState());

		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: {
						id: 'open-recent',
						title: 'Open Recent',
						submenu: OPEN_RECENT_MENU,
						group: '1_open',
						order: 10
					}
				}),
			'menu app/file open-recent'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'file.clearRecent',
					title: 'Clear recent files',
					run: () => recent.clear()
				}),
			'command file.clearRecent'
		);

		const refreshQuietly = (): void => {
			recent.refresh().catch((error: unknown) => ctx.logger.error('recent files', error));
		};
		ctx.on('file/attached', refreshQuietly);
		ctx.effect(() => {
			refreshQuietly();
			return () => recent.dispose();
		}, 'recent-files:menu');
	}
};
