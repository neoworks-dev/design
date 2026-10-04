import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, RecentFile } from '../../../electron/bridge';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import recentFiles from './index';

function recent(name: string): RecentFile {
	return { path: `/docs/${name}.ndesign`, name, openedAt: 1, thumbnail: null };
}

function bridgeWith(
	list: () => RecentFile[],
	clear = vi.fn(() => Promise.resolve())
): Partial<DesktopBridge> {
	const files: Partial<DesktopBridge['files']> = {
		recent: vi.fn(() => Promise.resolve(list())),
		clearRecent: clear
	};
	return { files: files as DesktopBridge['files'] };
}

const providers = [
	coreRegions,
	coreContextKeys,
	coreKeymap,
	coreCommands,
	coreMenus,
	desktopBridge
];

describePlugin('recent-files', recentFiles, {
	providers,
	desktop: bridgeWith(() => [recent('one'), recent('two')]),
	contributes: async ({ ctx }) => {
		await vi.waitFor(() => expect(ctx.recentFiles.entries).toHaveLength(2));
		const [openRecent] = ctx.menus.resolve('app/file');
		expect(openRecent.title).toBe('Open Recent');
		const items = ctx.menus.resolve('app/file/open-recent');
		expect(items.map((item) => item.title)).toEqual(['one', 'two', 'Clear recent files']);
		expect(items[0]).toMatchObject({ command: 'file.open', args: { path: '/docs/one.ndesign' } });
	}
});

describe('recent files menu', () => {
	it('shows no submenu while the list is empty', async () => {
		const mounted = await mountPlugin(recentFiles, { providers, desktop: bridgeWith(() => []) });
		await vi.waitFor(() => expect(mounted.ctx.recentFiles.snapshotState()).toBeDefined());
		await Promise.resolve();
		expect(mounted.ctx.menus.resolve('app/file')).toEqual([]);
		await mounted.cleanup();
	});

	it('follows the list after a file is attached and clears it with the command', async () => {
		let list = [recent('one')];
		const clear = vi.fn(() => {
			list = [];
			return Promise.resolve();
		});
		const mounted = await mountPlugin(recentFiles, {
			providers,
			desktop: bridgeWith(() => list, clear)
		});
		const { ctx } = mounted;
		await vi.waitFor(() => expect(ctx.recentFiles.entries).toHaveLength(1));
		list = [recent('two'), recent('one')];
		ctx.emit('file/attached', {} as never);
		await vi.waitFor(() => expect(ctx.recentFiles.entries).toHaveLength(2));
		expect(ctx.menus.resolve('app/file/open-recent').map((item) => item.title)).toEqual([
			'two',
			'one',
			'Clear recent files'
		]);
		await ctx.commands.run('file.clearRecent');
		expect(clear).toHaveBeenCalled();
		expect(ctx.recentFiles.entries).toHaveLength(0);
		expect(ctx.menus.resolve('app/file')).toEqual([]);
		await mounted.cleanup();
	});
});
