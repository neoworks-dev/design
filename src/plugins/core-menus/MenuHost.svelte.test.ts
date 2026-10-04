import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreRegions from '../core-regions';
import coreMenus from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreMenus];

let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;
let mounted: MountedPlugin | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function renderHost(): Promise<{ ran: string[]; mounted: MountedPlugin }> {
	const consumer = {
		name: 'consumer',
		inject: ['menus', 'commands', 'keymap', 'contextKeys'],
		apply(): void {}
	};
	mounted = await mountPlugin(consumer, { providers });
	const { ctx } = mounted;
	const ran: string[] = [];
	for (const id of ['a', 'b', 'c']) {
		ctx.commands.register({ id, title: `Item ${id}`, run: () => void ran.push(id) });
	}
	ctx.commands.register({
		id: 'off',
		title: 'Disabled',
		when: 'never',
		run: () => void ran.push('off')
	});
	ctx.keymap.register({ key: 'Mod+K', command: 'a' });
	ctx.menus.register({ menu: 'context/canvas', item: { id: 'a', command: 'a', group: '1' } });
	ctx.menus.register({ menu: 'context/canvas', item: { id: 'off', command: 'off', group: '1' } });
	ctx.menus.register({ menu: 'context/canvas', item: { id: 'b', command: 'b', group: '2' } });
	ctx.menus.register({
		menu: 'context/canvas',
		item: { id: 'more', title: 'More', submenu: 'context/canvas/more', group: '2' }
	});
	ctx.menus.register({ menu: 'context/canvas/more', item: { id: 'c', command: 'c' } });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'overlay' } });
	flushSync();
	return { ran, mounted };
}

function press(element: Element | null | undefined, key: string): void {
	element?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

function menuItems(): HTMLButtonElement[] {
	return [...(target?.querySelectorAll<HTMLButtonElement>('[data-menu-item]') ?? [])];
}

describe('MenuHost', () => {
	it('renders nothing until a menu is opened, then the resolved items', async () => {
		const { mounted: current } = await renderHost();
		expect(target?.querySelector('[role="menu"]')).toBeNull();
		current.ctx.menus.open('canvas', { x: 30, y: 40 });
		flushSync();
		expect(target?.querySelector('[data-menu-popup="canvas"]')).not.toBeNull();
		expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
			'Item a Ctrl+K',
			'Disabled',
			'Item b',
			'More'
		]);
		expect(target?.querySelectorAll('[role="separator"]')).toHaveLength(1);
		expect(menuItems()[1].disabled).toBe(true);
		const popup = target?.querySelector<HTMLElement>('[data-menu-popup]');
		expect(popup?.style.left).toBe('30px');
	});

	it('runs the clicked command and closes', async () => {
		const { ran, mounted: current } = await renderHost();
		current.ctx.menus.open('canvas', { x: 0, y: 0 });
		flushSync();
		menuItems()[2].click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(ran).toEqual(['b']);
		expect(target?.querySelector('[role="menu"]')).toBeNull();
	});

	it('Escape closes, and the key does not reach window listeners', async () => {
		const { mounted: current } = await renderHost();
		let reachedWindow = false;
		const spy = (): void => {
			reachedWindow = true;
		};
		window.addEventListener('keydown', spy);
		current.ctx.menus.open('canvas', { x: 0, y: 0 });
		flushSync();
		press(target?.querySelector('[role="menu"]'), 'Escape');
		window.removeEventListener('keydown', spy);
		expect(target?.querySelector('[role="menu"]')).toBeNull();
		expect(reachedWindow).toBe(false);
	});

	it('arrow keys move through enabled items and Enter activates', async () => {
		const { ran, mounted: current } = await renderHost();
		current.ctx.menus.open('canvas', { x: 0, y: 0 });
		flushSync();
		const menu = target?.querySelector('[role="menu"]');
		press(menu, 'ArrowDown');
		expect(document.activeElement).toBe(menuItems()[0]);
		press(document.activeElement, 'ArrowDown');
		expect(document.activeElement).toBe(menuItems()[2]);
		press(document.activeElement, 'ArrowUp');
		expect(document.activeElement).toBe(menuItems()[0]);
		press(document.activeElement, 'End');
		expect(document.activeElement).toBe(menuItems()[3]);
		(document.activeElement as HTMLElement).blur();
		expect(ran).toEqual([]);
	});

	it('ArrowRight opens a submenu, ArrowLeft returns to its item', async () => {
		const { ran, mounted: current } = await renderHost();
		current.ctx.menus.open('canvas', { x: 0, y: 0 });
		flushSync();
		const more = menuItems()[3];
		more.focus();
		press(more, 'ArrowRight');
		await Promise.resolve();
		flushSync();
		expect(target?.querySelectorAll('[role="menu"]')).toHaveLength(2);
		const submenuItem = target?.querySelector<HTMLButtonElement>('[data-menu-item="c"]');
		expect(submenuItem).not.toBeNull();
		expect(document.activeElement).toBe(submenuItem);
		press(submenuItem, 'ArrowLeft');
		expect(target?.querySelectorAll('[role="menu"]')).toHaveLength(1);
		expect(document.activeElement).toBe(more);
		expect(ran).toEqual([]);
	});

	it('a click on the backdrop closes the menu', async () => {
		const { mounted: current } = await renderHost();
		current.ctx.menus.open('canvas', { x: 0, y: 0 });
		flushSync();
		target
			?.querySelector('[data-menu-backdrop]')
			?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		flushSync();
		expect(current.ctx.menus.popup).toBeNull();
	});
});
