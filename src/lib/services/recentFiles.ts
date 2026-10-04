// The renderer's `recentFiles` service: the recent documents main keeps, and the "Open Recent"
// submenu generated from them. Items are registered through `ctx.menus` and replaced whenever the
// list is refreshed; each is a `file.open` with the path as argument, so opening a recent file
// takes exactly the same route as the Open dialog.

import { Service, type Context } from '@neoworks/extension-system';
import type { RecentFile } from '../../../electron/bridge';
import type { RecentFilesState } from './recentFilesState.svelte';

export const OPEN_RECENT_MENU = 'app/file/open-recent';

export interface RecentFilesDesktop {
	filesRecent(): Promise<RecentFile[]>;
	filesClearRecent(): Promise<void>;
}

export class RecentFilesService extends Service {
	private readonly itemDisposers: (() => Promise<void>)[] = [];

	constructor(
		ctx: Context,
		private readonly desktop: RecentFilesDesktop,
		private readonly state: RecentFilesState
	) {
		super(ctx, 'recentFiles');
	}

	/** Reactive: recent documents, newest first. */
	get entries(): readonly RecentFile[] {
		return this.state.entries;
	}

	/** Ask main for the list and rebuild the submenu from it. */
	async refresh(): Promise<void> {
		const entries = await this.desktop.filesRecent();
		this.state.entries = entries;
		await this.rebuildMenu(entries);
	}

	async clear(): Promise<void> {
		await this.desktop.filesClearRecent();
		await this.refresh();
	}

	/** Remove the generated items (plugin unmount). */
	async dispose(): Promise<void> {
		this.state.entries = [];
		await this.rebuildMenu([]);
	}

	snapshotState(): unknown {
		return { entries: this.state.entries.length, items: this.itemDisposers.length };
	}

	private async rebuildMenu(entries: readonly RecentFile[]): Promise<void> {
		const previous = this.itemDisposers.splice(0);
		for (const remove of previous) await remove();
		entries.forEach((entry, index) => {
			this.itemDisposers.push(
				this.ctx.effect(
					() =>
						this.ctx.menus.register({
							menu: OPEN_RECENT_MENU,
							item: {
								id: `file:${entry.path}`,
								command: 'file.open',
								title: entry.name,
								args: { path: entry.path },
								group: '1_files',
								order: index
							}
						}),
					`menu ${OPEN_RECENT_MENU} ${entry.path}`
				)
			);
		});
		if (entries.length === 0) return;
		this.itemDisposers.push(
			this.ctx.effect(
				() =>
					this.ctx.menus.register({
						menu: OPEN_RECENT_MENU,
						item: { id: 'clear', command: 'file.clearRecent', group: '2_clear' }
					}),
				`menu ${OPEN_RECENT_MENU} clear`
			)
		);
	}
}
