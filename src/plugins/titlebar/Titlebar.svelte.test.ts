import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import {
	describePlugin,
	mountPlugin,
	type FakeDesktop,
	type MountedPlugin,
	type MountOptions
} from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import titlebar from './index';

const providers = [coreRegions, coreContextKeys, coreCommands, desktopBridge];

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

async function renderTitlebar(
	platform = 'linux',
	desktop: MountOptions['desktop'] = {
		system: { platform: platform as NodeJS.Platform, arch: 'x64' }
	}
): Promise<MountedPlugin> {
	mounted = await mountPlugin(titlebar, { providers, desktop });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'top-bar' } });
	flushSync();
	return mounted;
}

function fakeDesktop(): FakeDesktop {
	if (!mounted?.desktop) throw new Error('mounted without a fake desktop');
	return mounted.desktop;
}

function controlButtons(): HTMLButtonElement[] {
	return [...(target?.querySelectorAll<HTMLButtonElement>('[data-window-controls] button') ?? [])];
}

describe('titlebar', () => {
	it('shows no file name before a file is open, and three window controls on linux', async () => {
		await renderTitlebar();
		expect(target?.querySelector('[data-document-title]')).toBeNull();
		expect(target?.querySelector('[data-save-status]')).toBeNull();
		expect(controlButtons()).toHaveLength(3);
		expect(document.title).toBe('Draftboard');
	});

	it('gives the window controls accessible names', async () => {
		await renderTitlebar();
		expect(controlButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
			'Minimize window',
			'Maximize window',
			'Close window'
		]);
	});

	it('swaps the maximize button to restore from the window:maximized event', async () => {
		await renderTitlebar();
		const label = (): string | null => controlButtons()[1].getAttribute('aria-label');
		const icon = (): string | undefined => controlButtons()[1].innerHTML;
		const normalIcon = icon();
		fakeDesktop().emit('window:maximized', true);
		flushSync();
		expect(label()).toBe('Restore window');
		expect(icon()).not.toBe(normalIcon);
		expect(mounted?.ctx.contextKeys.get('window.maximized')).toBe(true);

		fakeDesktop().emit('window:maximized', false);
		flushSync();
		expect(label()).toBe('Maximize window');
		expect(icon()).toBe(normalIcon);
	});

	it('starts with the restore icon when the window is already maximized', async () => {
		await renderTitlebar('linux', {
			system: { platform: 'linux', arch: 'x64' },
			window: {
				minimize: () => Promise.resolve(),
				toggleMaximize: () => Promise.resolve(true),
				isMaximized: () => Promise.resolve(true),
				close: () => Promise.resolve()
			}
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		expect(controlButtons()[1].getAttribute('aria-label')).toBe('Restore window');
	});

	it('the controls minimize, toggle maximize and close through the bridge', async () => {
		await renderTitlebar();
		const [minimize, maximize, close] = controlButtons();
		minimize.click();
		maximize.click();
		close.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fakeDesktop().calls).toEqual([
			'window.isMaximized',
			'window.minimize',
			'window.toggleMaximize',
			'window.close'
		]);
	});

	it('double click on the drag region toggles maximize', async () => {
		await renderTitlebar();
		target
			?.querySelector('[data-titlebar]')
			?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fakeDesktop().calls).toEqual(['window.isMaximized', 'window.toggleMaximize']);
	});

	it('hides the controls on macOS, which keeps its traffic lights', async () => {
		await renderTitlebar('darwin');
		expect(controlButtons()).toHaveLength(0);
		expect(target?.querySelector('[data-titlebar]')?.classList.contains('pl-20')).toBe(true);
	});

	it('shows no window controls in a plain browser (no preload bridge)', async () => {
		mounted = await mountPlugin(titlebar, { providers });
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'top-bar' } });
		flushSync();
		expect(controlButtons()).toHaveLength(0);
		expect(target.querySelector('[data-titlebar]')).not.toBeNull();
	});

	it('shows the file name and the saving status from context keys, never a dirty dot', async () => {
		const { ctx } = await renderTitlebar();
		ctx.contextKeys.set('document.renamable', true);
		ctx.contextKeys.set('document.title', 'Mobile app');
		flushSync();
		expect(target?.querySelector('[data-document-title]')?.textContent?.trim()).toBe('Mobile app');
		expect(target?.querySelector('[data-save-status]')?.textContent).toBe('Saved');
		expect(document.title).toBe('Mobile app - Draftboard');

		ctx.contextKeys.set('document.saving', true);
		flushSync();
		expect(target?.querySelector('[data-save-status]')?.textContent).toBe('Saving...');
		expect(target?.querySelector('[data-dirty-marker]')).toBeNull();
	});

	it('renames the file inline: Enter commits through file.rename, Escape cancels', async () => {
		const { ctx } = await renderTitlebar();
		const renamed: unknown[] = [];
		ctx.commands.register({
			id: 'file.rename',
			title: 'Rename file',
			run: async (args) => {
				if (args === undefined) {
					await ctx.commands.run('titlebar.rename');
					return;
				}
				renamed.push(args);
			}
		});
		ctx.contextKeys.set('document.renamable', true);
		ctx.contextKeys.set('document.title', 'Mobile app');
		flushSync();
		target
			?.querySelector('[data-document-title]')
			?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
		const input = target?.querySelector<HTMLInputElement>('[data-title-input]');
		expect(input).not.toBeNull();
		if (!input) return;
		input.value = 'Checkout';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(renamed).toEqual([{ name: 'Checkout' }]);
		expect(target?.querySelector('[data-title-input]')).toBeNull();

		await ctx.commands.run('titlebar.rename');
		flushSync();
		const second = target?.querySelector<HTMLInputElement>('[data-title-input]');
		second?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(renamed).toHaveLength(1);
		expect(target?.querySelector('[data-title-input]')).toBeNull();
	});

	it('removes its contributions and restores the window title when unmounted', async () => {
		const { fiber, ctx } = await renderTitlebar();
		await fiber.dispose();
		flushSync();
		expect(target?.querySelector('[data-titlebar]')).toBeNull();
		expect(ctx.commands.has('titlebar.close')).toBe(false);
		expect(ctx.contextKeys.get('window.maximized')).toBeUndefined();
		expect(ctx.contextKeys.get('titlebar.renaming')).toBeUndefined();
	});
});

describePlugin('titlebar', titlebar, {
	providers,
	desktop: true,
	contributes: ({ ctx, desktop }) => {
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toEqual([
			'titlebar/title',
			'titlebar/window-controls'
		]);
		expect(ctx.commands.has('titlebar.minimize')).toBe(true);
		expect(desktop).toBeDefined();
	}
});
