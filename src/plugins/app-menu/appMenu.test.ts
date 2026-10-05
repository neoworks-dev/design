import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeMenuItem } from '../../../electron/bridge';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import appMenu from './index';

const providers = [
	coreRegions,
	coreContextKeys,
	coreCommands,
	coreKeymap,
	coreMenus,
	desktopBridge
];

function desktopOptions(
	platform: NodeJS.Platform,
	set: (items: NativeMenuItem[]) => Promise<void>
): { system: { platform: NodeJS.Platform; arch: string }; menu: { set: typeof set } } {
	return { system: { platform, arch: 'x64' }, menu: { set } };
}

describePlugin('app-menu', appMenu, {
	providers,
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toEqual(['app-menu/bar']);
		expect(ctx.menus.resolve('app').map((item) => item.title)).toEqual([
			'File',
			'Edit',
			'View',
			'Object',
			'Help'
		]);
	}
});

let mounted: MountedPlugin | undefined;
let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountAppMenu(
	platform: NodeJS.Platform = 'linux',
	set: (items: NativeMenuItem[]) => Promise<void> = () => Promise.resolve()
): Promise<MountedPlugin> {
	mounted = await mountPlugin(appMenu, { providers, desktop: desktopOptions(platform, set) });
	return mounted;
}

function render(ctx: MountedPlugin['ctx']): HTMLElement {
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'top-bar' } });
	flushSync();
	return target;
}

function lastTree(set: ReturnType<typeof vi.fn>): NativeMenuItem[] {
	const call = set.mock.calls[set.mock.calls.length - 1];
	return call[0] as NativeMenuItem[];
}

describe('in-window menu bar', () => {
	it('shows one button per menu that has items and opens its menu on click', async () => {
		const { ctx } = await mountAppMenu();
		const element = render(ctx);
		const labels = [...element.querySelectorAll('[data-menu-bar-item]')].map((button) =>
			button.textContent?.trim()
		);
		expect(labels).toEqual(['File', 'Edit', 'View', 'Object', 'Help']);
		element.querySelector<HTMLButtonElement>('[data-menu-bar-item="app/edit"]')?.click();
		expect(ctx.menus.popup?.menu).toBe('app/edit');
	});

	it('a plugin adding to app/plugins makes the Plugins menu appear', async () => {
		const { ctx } = await mountAppMenu();
		const element = render(ctx);
		ctx.commands.register({ id: 'my.plugin', title: 'My plugin', run: () => {} });
		const dispose = ctx.menus.register({
			menu: 'app/plugins',
			item: { id: 'my.plugin', command: 'my.plugin' }
		});
		flushSync();
		expect(element.querySelector('[data-menu-bar-item="app/plugins"]')).not.toBeNull();
		dispose();
		flushSync();
		expect(element.querySelector('[data-menu-bar-item="app/plugins"]')).toBeNull();
	});

	it('menu items run their command', async () => {
		const { ctx } = await mountAppMenu();
		const ran: string[] = [];
		ctx.commands.register({ id: 'file.new', title: 'New file', run: () => void ran.push('new') });
		const item = ctx.menus.resolve('app/file').find((entry) => entry.command === 'file.new');
		expect(item?.title).toBe('New file');
		if (!item) throw new Error('no item');
		await ctx.menus.activate(item);
		expect(ran).toEqual(['new']);
	});

	it('is not drawn on macOS, which has the native menu bar', async () => {
		const { ctx } = await mountAppMenu('darwin');
		const element = render(ctx);
		expect(element.querySelector('[data-menu-bar]')).toBeNull();
	});
});

describe('native menu mirror', () => {
	it('sends the resolved tree with accelerators from the keymap', async () => {
		const set = vi.fn(() => Promise.resolve());
		const { ctx } = await mountAppMenu('linux', set);
		ctx.commands.register({ id: 'file.new', title: 'New file', run: () => {} });
		ctx.keymap.register({ key: 'Mod+N', command: 'file.new', source: 'test' });
		flushSync();
		const file = lastTree(set).find((item) => item.label === 'File');
		const newFile = file?.submenu?.find((item) => item.command === 'file.new');
		expect(newFile).toMatchObject({ label: 'New file', accelerator: 'Ctrl+N', enabled: true });
	});

	it('keeps checked and disabled state in sync', async () => {
		const set = vi.fn(() => Promise.resolve());
		const { ctx } = await mountAppMenu('linux', set);
		ctx.commands.register({
			id: 'edit.rename',
			title: 'Rename',
			when: 'hasSelection',
			run: () => {}
		});
		flushSync();
		const find = (): NativeMenuItem | undefined =>
			lastTree(set)
				.find((item) => item.label === 'Edit')
				?.submenu?.find((item) => item.command === 'edit.rename');
		expect(find()).toBeUndefined();

		ctx.commands.register({
			id: 'node.delete',
			title: 'Delete',
			when: 'hasSelection',
			run: () => {}
		});
		flushSync();
		const deleteItem = (): NativeMenuItem | undefined =>
			lastTree(set)
				.find((item) => item.label === 'Edit')
				?.submenu?.find((item) => item.command === 'node.delete');
		expect(deleteItem()?.enabled).toBe(false);
		const unset = ctx.contextKeys.set('hasSelection', true);
		flushSync();
		expect(deleteItem()?.enabled).toBe(true);
		unset();
	});

	it('does not re-send an unchanged tree', async () => {
		const set = vi.fn(() => Promise.resolve());
		const { ctx } = await mountAppMenu('linux', set);
		flushSync();
		const calls = set.mock.calls.length;
		ctx.contextKeys.set('somethingUnrelated', true);
		flushSync();
		expect(set.mock.calls.length).toBe(calls);
	});

	it('runs the command of a native click pushed back from main', async () => {
		const { ctx, desktop } = await mountAppMenu();
		const ran: unknown[] = [];
		ctx.commands.register({ id: 'file.new', title: 'New', run: (args) => void ran.push(args) });
		desktop?.emit('menu:command', { command: 'file.new', args: { from: 'native' } });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ran).toEqual([{ from: 'native' }]);
	});
});
