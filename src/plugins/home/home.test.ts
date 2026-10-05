import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DraftFile, RecentFile } from '../../../electron/bridge';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import home from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, desktopBridge];

const recent = (name: string, openedAt: number): RecentFile => ({
	path: `/docs/${name}.ndesign`,
	name,
	openedAt,
	thumbnail: null
});
const draft = (name: string, modifiedAt: number): DraftFile => ({
	path: `/untitled/${name}.ndesign`,
	name,
	modifiedAt,
	thumbnail: null
});

function bridgeWith(
	recents: () => RecentFile[],
	drafts: () => DraftFile[] = () => []
): {
	bridge: Partial<DesktopBridge>;
	removeRecent: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
	reveal: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
} {
	const removeRecent = vi.fn((_path: string) => Promise.resolve());
	const reveal = vi.fn((_path: string) => Promise.resolve());
	const files: Partial<DesktopBridge['files']> = {
		recent: () => Promise.resolve(recents()),
		drafts: () => Promise.resolve(drafts()),
		removeRecent,
		reveal
	};
	return { bridge: { files: files as DesktopBridge['files'] }, removeRecent, reveal };
}

describePlugin('home', home, {
	providers,
	desktop: bridgeWith(() => []).bridge,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('home.show')).toBe(true);
		const regions = ctx.regions.contributions('overlay').map((entry) => entry.id);
		expect(regions).toContain('home/screen');
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toContain('home/button');
		expect(ctx.home.visible).toBe(false);
	}
});

describe('the home service', () => {
	it('is visible when the document was closed, or when asked, and hides when a file attaches', async () => {
		const mounted = await mountPlugin(home, { providers, desktop: bridgeWith(() => []).bridge });
		const { ctx } = mounted;
		expect(ctx.home.visible).toBe(false);
		const unset = ctx.contextKeys.set('document.closed', true);
		expect(ctx.home.visible).toBe(true);
		unset();
		expect(ctx.home.visible).toBe(false);

		await ctx.commands.run('home.show');
		expect(ctx.home.visible).toBe(true);
		ctx.emit('file/attached', {} as never);
		expect(ctx.home.visible).toBe(false);
		await mounted.cleanup();
	});

	it('lists recents and drafts, searches, sorts and switches sections', async () => {
		const { bridge } = bridgeWith(
			() => [recent('Beta', 20), recent('alpha', 10)],
			() => [draft('Scratch', 30)]
		);
		const mounted = await mountPlugin(home, { providers, desktop: bridge });
		const { home: service } = mounted.ctx;
		await service.refresh();
		expect(service.entries().map((entry) => entry.name)).toEqual(['Beta', 'alpha']);
		service.setSection('drafts');
		expect(service.entries().map((entry) => entry.name)).toEqual(['Scratch']);
		service.setSection('all');
		service.setSort('name');
		expect(service.entries().map((entry) => entry.name)).toEqual(['alpha', 'Beta', 'Scratch']);
		service.setQuery('sCr');
		expect(service.entries().map((entry) => entry.name)).toEqual(['Scratch']);
		expect(service.countIn('recents')).toBe(2);
		await mounted.cleanup();
	});

	it('open and new go through the file commands, with the path of the entry', async () => {
		const { bridge } = bridgeWith(() => [recent('a', 1)]);
		const mounted = await mountPlugin(home, { providers, desktop: bridge });
		const { ctx } = mounted;
		const opened: unknown[] = [];
		const created: number[] = [];
		ctx.commands.register({
			id: 'file.open',
			title: 'Open',
			run: (args) => void opened.push(args)
		});
		ctx.commands.register({ id: 'file.new', title: 'New', run: () => void created.push(1) });
		await ctx.home.refresh();
		await ctx.commands.run('home.show');

		await ctx.home.open(ctx.home.entries()[0]);
		expect(opened).toEqual([{ path: '/docs/a.ndesign' }]);
		expect(ctx.home.visible).toBe(false);

		await ctx.commands.run('home.show');
		await ctx.home.newFile();
		expect(created).toEqual([1]);
		expect(ctx.home.visible).toBe(false);
		await mounted.cleanup();
	});

	it('removes a recent file through main, reloads the list, and reveals files', async () => {
		let list = [recent('a', 1), recent('b', 2)];
		const { bridge, removeRecent, reveal } = bridgeWith(() => list);
		removeRecent.mockImplementation((path) => {
			list = list.filter((entry) => entry.path !== path);
			return Promise.resolve();
		});
		const mounted = await mountPlugin(home, { providers, desktop: bridge });
		const { home: service } = mounted.ctx;
		await service.refresh();
		const [first] = service.entries();
		await service.removeRecent(first);
		expect(removeRecent).toHaveBeenCalledWith(first.path);
		expect(service.entries().map((entry) => entry.name)).toEqual(['a']);
		await service.reveal(service.entries()[0]);
		expect(reveal).toHaveBeenCalledWith('/docs/a.ndesign');
		await mounted.cleanup();
	});
});
