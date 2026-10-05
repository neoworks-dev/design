import { flushSync, mount, unmount } from 'svelte';
import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import coreTools from '../core-tools';
import toolbar from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreMenus, coreTools];

describePlugin('toolbar', toolbar, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.regions.contributions('toolbar')).toEqual([]);
		const dispose = ctx.tools.register({ id: 'move', title: 'Move' });
		expect(ctx.regions.contributions('toolbar').map((entry) => entry.id)).toEqual(['toolbar/bar']);
		dispose();
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

function renderToolbar(ctx: MountedPlugin['ctx']): HTMLElement {
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'toolbar' } });
	flushSync();
	return target;
}

describe('toolbar rendering', () => {
	it('renders one labelled button per tool, marks the active one and activates on click', async () => {
		const { ctx } = await mountToolbar();
		ctx.tools.register({ id: 'move', title: 'Move', icon: CursorIcon, shortcut: 'V', group: 'a' });
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle', icon: SquareIcon, group: 'b' });
		const element = renderToolbar(ctx);

		const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-slot] button')];
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Move',
			'Rectangle'
		]);
		expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

		buttons[1].click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(ctx.tools.activeId()).toBe('rectangle');
		expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

		buttons[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		expect(ctx.tools.locked).toBe(true);
		expect(buttons[1].hasAttribute('data-locked')).toBe(true);
	});

	it('shows a caret for dropdown groups that opens the group menu', async () => {
		const { ctx } = await mountToolbar();
		ctx.tools.register({ id: 'frame', title: 'Frame', icon: SquareIcon, toolbarGroup: 'frame' });
		ctx.tools.register({
			id: 'slice',
			title: 'Slice',
			icon: SquareIcon,
			toolbarGroup: 'frame',
			order: 1
		});
		const element = renderToolbar(ctx);
		element.querySelector<HTMLButtonElement>('[data-slot-caret=frame]')?.click();
		expect(ctx.menus.popup?.menu).toBe('toolbar/group/frame');
	});

	it('removes the toolbar when no tool is registered', async () => {
		const { ctx } = await mountToolbar();
		const element = renderToolbar(ctx);
		expect(element.querySelector('[role="toolbar"]')).toBeNull();
		ctx.tools.register({ id: 'move', title: 'Move', icon: CursorIcon });
		flushSync();
		expect(element.querySelector('[role="toolbar"]')).not.toBeNull();
	});
});

async function mountToolbar(): Promise<MountedPlugin> {
	mounted = await mountPlugin(toolbar, { providers });
	return mounted;
}

describe('toolbar slots', () => {
	it('registering a tool adds its button and disposing removes it', async () => {
		const { ctx } = await mountToolbar();
		const dispose = ctx.tools.register({ id: 'text', title: 'Text', order: 1 });
		expect(ctx.toolbar.slots().map((slot) => slot.id)).toEqual(['tool:text']);
		dispose();
		expect(ctx.toolbar.slots()).toEqual([]);
	});

	it('collapses tools of one toolbarGroup into one slot', async () => {
		const { ctx } = await mountToolbar();
		ctx.tools.register({ id: 'frame', title: 'Frame', toolbarGroup: 'frame', order: 1 });
		ctx.tools.register({ id: 'section', title: 'Section', toolbarGroup: 'frame', order: 2 });
		ctx.tools.register({ id: 'text', title: 'Text', order: 3 });
		const slots = ctx.toolbar.slots();
		expect(slots.map((slot) => slot.id)).toEqual(['frame', 'tool:text']);
		expect(slots[0].entries.map((entry) => entry.id)).toEqual(['frame', 'section']);
	});

	it('members with toolbar false are reachable through the dropdown only', async () => {
		const { ctx } = await mountToolbar();
		ctx.tools.register({ id: 'rectangle', title: 'Rectangle', toolbarGroup: 'shapes' });
		ctx.tools.register({
			id: 'star',
			title: 'Star',
			toolbarGroup: 'shapes',
			toolbar: false,
			order: 2
		});
		ctx.tools.register({ id: 'hand', title: 'Hand', toolbar: false });
		expect(ctx.toolbar.slots().map((slot) => slot.entries.length)).toEqual([2]);
	});

	it('the dropdown remembers the last used tool', async () => {
		const { ctx } = await mountToolbar();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.register({ id: 'frame', title: 'Frame', toolbarGroup: 'frame', order: 1 });
		ctx.tools.register({ id: 'slice', title: 'Slice', toolbarGroup: 'frame', order: 2 });
		const slot = ctx.toolbar.slots()[1];
		expect(ctx.toolbar.shown(slot).id).toBe('frame');
		ctx.tools.activate('slice');
		ctx.tools.activate('move');
		expect(ctx.toolbar.shown(ctx.toolbar.slots()[1]).id).toBe('slice');
	});

	it('publishes one menu item per group member, checked while active, and removes them', async () => {
		const { ctx, currentState } = await mountToolbar();
		const before = currentState();
		const dispose = [
			ctx.tools.register({ id: 'frame', title: 'Frame', toolbarGroup: 'frame', order: 1 }),
			ctx.tools.register({ id: 'slice', title: 'Slice', toolbarGroup: 'frame', order: 2 })
		];
		flushSync();
		ctx.tools.activate('slice');
		flushSync();
		const items = ctx.menus.resolve('toolbar/group/frame');
		expect(items.map((item) => [item.id, item.checked])).toEqual([
			['frame', false],
			['slice', true]
		]);
		dispose.forEach((remove) => remove());
		flushSync();
		expect(ctx.menus.resolve('toolbar/group/frame')).toEqual([]);
		expect(currentState().registries).toEqual(before.registries);
	});

	it('opens a group dropdown above the toolbar', async () => {
		const { ctx } = await mountToolbar();
		ctx.toolbar.openGroupMenu('frame', { x: 10, y: 20 });
		expect(ctx.menus.popup).toMatchObject({ menu: 'toolbar/group/frame', placement: 'above' });
	});
});
