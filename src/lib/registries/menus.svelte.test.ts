import type { Context } from '@neoworks/extension-system';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import coreMenus from '../../plugins/core-menus';
import coreRegions from '../../plugins/core-regions';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreMenus];

async function mountConsumer(): Promise<MountedPlugin> {
	const consumer = {
		name: 'consumer',
		inject: ['menus', 'commands', 'keymap', 'contextKeys'],
		apply(): void {}
	};
	return mountPlugin(consumer, { providers });
}

function titles(ctx: Context, menu: string): string[] {
	return ctx.menus.resolve(menu).map((item) => item.title);
}

describe('menus', () => {
	it('resolves registered items and dispose removes them', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'file.new', title: 'New file', run: () => {} });
		const dispose = ctx.menus.register({
			menu: 'app/file',
			item: { id: 'new', command: 'file.new' }
		});
		expect(ctx.menus.resolve('app/file')).toMatchObject([
			{ id: 'new', title: 'New file', command: 'file.new', enabled: true, checked: false }
		]);
		dispose();
		expect(ctx.menus.resolve('app/file')).toEqual([]);
		await cleanup();
	});

	it('shows and hides items with their when expression', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'node.rename', title: 'Rename', run: () => {} });
		ctx.menus.register({
			menu: 'context/layer',
			item: { id: 'rename', command: 'node.rename', when: 'hasSelection' }
		});
		expect(titles(ctx, 'context/layer')).toEqual([]);
		const unset = ctx.contextKeys.set('hasSelection', true);
		expect(titles(ctx, 'context/layer')).toEqual(['Rename']);
		unset();
		expect(titles(ctx, 'context/layer')).toEqual([]);
		await cleanup();
	});

	it('layers target facts over the global context keys', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'x.run', title: 'Run', run: () => {} });
		ctx.menus.register({
			menu: 'context/canvas',
			item: { id: 'run', command: 'x.run', when: 'targetIsText' }
		});
		expect(ctx.menus.resolve('context/canvas')).toEqual([]);
		expect(ctx.menus.resolve('context/canvas', { targetIsText: true })).toHaveLength(1);
		await cleanup();
	});

	it('resolves every context menu kind independently', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'a', title: 'A', run: () => {} });
		ctx.commands.register({ id: 'b', title: 'B', run: () => {} });
		ctx.menus.register({ menu: 'context/canvas', item: { id: 'a', command: 'a' } });
		ctx.menus.register({ menu: 'context/layer', item: { id: 'b', command: 'b' } });
		ctx.menus.register({ menu: 'context/layer', item: { id: 'a', command: 'a' } });
		expect(ctx.menus.resolve('context/canvas').map((item) => item.id)).toEqual(['a']);
		expect(ctx.menus.resolve('context/layer').map((item) => item.id)).toEqual(['b', 'a']);
		expect(ctx.menus.resolve('context/page')).toEqual([]);
		await cleanup();
	});

	it('derives separators from group changes and orders groups and items', async () => {
		const { ctx, cleanup } = await mountConsumer();
		for (const id of ['cut', 'copy', 'paste', 'delete']) {
			ctx.commands.register({ id, title: id, run: () => {} });
		}
		ctx.menus.register({ menu: 'm', item: { id: 'delete', command: 'delete', group: '9_danger' } });
		ctx.menus.register({
			menu: 'm',
			item: { id: 'paste', command: 'paste', group: '1_edit', order: 2 }
		});
		ctx.menus.register({
			menu: 'm',
			item: { id: 'copy', command: 'copy', group: '1_edit', order: 1 }
		});
		ctx.menus.register({
			menu: 'm',
			item: { id: 'cut', command: 'cut', group: '1_edit', order: 0 }
		});
		const items = ctx.menus.resolve('m');
		expect(items.map((item) => item.id)).toEqual(['cut', 'copy', 'paste', 'delete']);
		expect(items.map((item) => item.separatorBefore)).toEqual([false, false, false, true]);
		await cleanup();
	});

	it('does not draw a separator before a group whose items are all hidden', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'a', title: 'A', run: () => {} });
		ctx.commands.register({ id: 'b', title: 'B', run: () => {} });
		ctx.menus.register({ menu: 'm', item: { id: 'a', command: 'a', group: '1' } });
		ctx.menus.register({ menu: 'm', item: { id: 'b', command: 'b', group: '2', when: 'never' } });
		expect(ctx.menus.resolve('m').map((item) => item.separatorBefore)).toEqual([false]);
		await cleanup();
	});

	it('takes accelerators from the keymap, reactively', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'view.zoom-in', title: 'Zoom in', run: () => {} });
		ctx.menus.register({ menu: 'app/view', item: { id: 'zoom-in', command: 'view.zoom-in' } });
		expect(ctx.menus.resolve('app/view')[0].accelerator).toBeUndefined();
		const unbind = ctx.keymap.register({ key: 'Mod+=', command: 'view.zoom-in' });
		expect(ctx.menus.resolve('app/view')[0].accelerator).toBe(ctx.keymap.lookup('view.zoom-in'));
		expect(ctx.menus.resolve('app/view')[0].accelerator).toMatch(/Ctrl\+=|⌘=/);
		unbind();
		expect(ctx.menus.resolve('app/view')[0].accelerator).toBeUndefined();
		await cleanup();
	});

	it('disables items whose command is disabled and checks toggled items', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'grid', title: 'Grid', when: 'canvasFocus', run: () => {} });
		ctx.menus.register({
			menu: 'app/view',
			item: { id: 'grid', command: 'grid', toggled: 'gridVisible' }
		});
		expect(ctx.menus.resolve('app/view')[0]).toMatchObject({ enabled: false, checked: false });
		ctx.contextKeys.set('canvasFocus', true);
		ctx.contextKeys.set('gridVisible', true);
		expect(ctx.menus.resolve('app/view')[0]).toMatchObject({ enabled: true, checked: true });
		await cleanup();
	});

	it('resolves submenus and hides one without visible items', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'export.png', title: 'PNG', run: () => {} });
		ctx.menus.register({
			menu: 'app/file',
			item: { id: 'export', title: 'Export', submenu: 'app/file/export' }
		});
		expect(ctx.menus.resolve('app/file')).toEqual([]);
		ctx.menus.register({
			menu: 'app/file/export',
			item: { id: 'png', command: 'export.png' }
		});
		const [exportItem] = ctx.menus.resolve('app/file');
		expect(exportItem.title).toBe('Export');
		expect(exportItem.submenu?.map((item) => item.id)).toEqual(['png']);
		await cleanup();
	});

	it('stops at a submenu cycle instead of recursing forever', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.menus.register({ menu: 'a', item: { id: 'to-b', title: 'B', submenu: 'b' } });
		ctx.menus.register({ menu: 'b', item: { id: 'to-a', title: 'A', submenu: 'a' } });
		expect(ctx.menus.resolve('a')).toEqual([]);
		await cleanup();
	});

	it('rejects an item without command or submenu, and a malformed when', async () => {
		const { ctx, cleanup } = await mountConsumer();
		expect(() => ctx.menus.register({ menu: 'm', item: { id: 'empty' } })).toThrow(
			/needs a command/
		);
		expect(() =>
			ctx.menus.register({ menu: 'm', item: { id: 'bad', command: 'x', when: 'a &&' } })
		).toThrow();
		await cleanup();
	});

	it('dispose by identity: a stale disposer does not remove a replacement', async () => {
		const { ctx, cleanup } = await mountConsumer();
		ctx.commands.register({ id: 'a', title: 'A', run: () => {} });
		const first = ctx.menus.register({
			menu: 'm',
			item: { id: 'x', command: 'a', title: 'First' }
		});
		ctx.menus.register({ menu: 'm', item: { id: 'x', command: 'a', title: 'Second' } });
		first();
		expect(titles(ctx, 'm')).toEqual(['Second']);
		await cleanup();
	});

	it('opens a popup for a target kind, runs the command with the target and closes', async () => {
		const { ctx, cleanup } = await mountConsumer();
		const received: unknown[] = [];
		ctx.commands.register({
			id: 'layer.rename',
			title: 'Rename',
			run: (args) => void received.push(args)
		});
		ctx.menus.register({ menu: 'context/layer', item: { id: 'rename', command: 'layer.rename' } });

		const node = { id: 'n1' };
		ctx.menus.open('layer', { x: 10, y: 20 }, node);
		expect(ctx.menus.popup).toMatchObject({
			kind: 'layer',
			menu: 'context/layer',
			point: { x: 10, y: 20 }
		});

		const [item] = ctx.menus.resolve('context/layer');
		await ctx.menus.activate(item);
		expect(received).toEqual([node]);
		expect(ctx.menus.popup).toBeNull();
		await cleanup();
	});

	it('does not run a disabled item', async () => {
		const { ctx, cleanup } = await mountConsumer();
		let runs = 0;
		ctx.commands.register({ id: 'x', title: 'X', when: 'never', run: () => void runs++ });
		ctx.menus.register({ menu: 'm', item: { id: 'x', command: 'x' } });
		await ctx.menus.activate(ctx.menus.resolve('m')[0]);
		expect(runs).toBe(0);
		await cleanup();
	});

	it('openFromEvent suppresses the native context menu', async () => {
		const { ctx, cleanup } = await mountConsumer();
		const event = new MouseEvent('contextmenu', { clientX: 5, clientY: 6, cancelable: true });
		ctx.menus.openFromEvent('canvas', event);
		flushSync();
		expect(event.defaultPrevented).toBe(true);
		expect(ctx.menus.popup?.point).toEqual({ x: 5, y: 6 });
		await cleanup();
	});
});

describePlugin('core-menus', coreMenus, {
	providers: [coreRegions, coreContextKeys, coreCommands, coreKeymap],
	contributes: ({ ctx }) => {
		expect(ctx.menus).toBeDefined();
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toEqual([
			'core-menus/host'
		]);
	}
});
