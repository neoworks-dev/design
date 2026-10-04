import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import {
	describePlugin,
	mountPlugin,
	type FakeDesktop,
	type MountedPlugin
} from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreRegions from '../core-regions';
import titlebar from './index';

const providers = [coreRegions, coreContextKeys, coreCommands];

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

async function renderTitlebar(platform = 'linux'): Promise<MountedPlugin> {
	mounted = await mountPlugin(titlebar, {
		providers,
		desktop: { system: { platform: platform as NodeJS.Platform, arch: 'x64' } }
	});
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
	it('shows the default title and three window controls on linux', async () => {
		await renderTitlebar();
		expect(target?.querySelector('[data-document-title]')?.textContent?.trim()).toBe('Untitled');
		expect(controlButtons()).toHaveLength(3);
		expect(document.title).toBe('Untitled - Neoworks Design');
	});

	it('the controls minimize, toggle maximize and close through the bridge', async () => {
		await renderTitlebar();
		const [minimize, maximize, close] = controlButtons();
		minimize.click();
		maximize.click();
		close.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fakeDesktop().calls).toEqual([
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
		expect(fakeDesktop().calls).toEqual(['window.toggleMaximize']);
	});

	it('hides the controls on macOS, which keeps its traffic lights', async () => {
		await renderTitlebar('darwin');
		expect(controlButtons()).toHaveLength(0);
		expect(target?.querySelector('[data-titlebar]')?.classList.contains('pl-20')).toBe(true);
	});

	it('shows the document title and the dirty marker from context keys', async () => {
		const { ctx } = await renderTitlebar();
		ctx.contextKeys.set('document.title', 'Mobile app');
		flushSync();
		expect(target?.querySelector('[data-document-title]')?.textContent?.trim()).toBe('Mobile app');
		expect(target?.querySelector('[data-dirty-marker]')).toBeNull();

		ctx.contextKeys.set('document.dirty', true);
		flushSync();
		expect(target?.querySelector('[data-dirty-marker]')).not.toBeNull();
		expect(document.title).toBe('• Mobile app - Neoworks Design');
	});

	it('removes its contributions and restores the window title when unmounted', async () => {
		const { fiber, ctx } = await renderTitlebar();
		await fiber.dispose();
		flushSync();
		expect(target?.querySelector('[data-titlebar]')).toBeNull();
		expect(ctx.commands.has('titlebar.close')).toBe(false);
		expect(document.title).not.toContain('Neoworks Design');
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
