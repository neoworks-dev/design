import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreRegions from '../core-regions';
import PlaceholderText from '../placeholder-shell/PlaceholderText.svelte';
import corePanels from './index';

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

async function renderRightSidebar(): Promise<MountedPlugin> {
	const storage = { getItem: (): null => null, setItem: (): void => {} };
	const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap];
	const panels = { ...corePanels, apply: (ctx: never) => corePanels.apply(ctx, { storage }) };
	mounted = await mountPlugin(
		{ name: 'consumer', inject: ['panels'], apply(): void {} },
		{ providers: [...providers, panels] }
	);
	const { ctx } = mounted;
	ctx.panels.registerTab({ id: 'design', side: 'right', title: 'Design', order: 0 });
	ctx.panels.registerTab({
		id: 'prototype',
		side: 'right',
		title: 'Prototype',
		order: 1,
		component: PlaceholderText,
		props: { text: 'prototype body' }
	});
	for (const [order, title] of ['Fill', 'Stroke'].entries()) {
		ctx.panels.registerSection({
			tab: 'design',
			id: title.toLowerCase(),
			title,
			order,
			component: PlaceholderText,
			props: { text: `${title} body` }
		});
	}
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'right' } });
	flushSync();
	return mounted;
}

function text(): string {
	return target?.textContent ?? '';
}

describe('SidebarHost', () => {
	it('renders the tab strip, the active tab and its sections in order', async () => {
		await renderRightSidebar();
		const tabs = [...(target?.querySelectorAll('[role="tab"]') ?? [])];
		expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Design', 'Prototype']);
		expect(tabs[0].getAttribute('aria-selected')).toBe('true');
		const sections = [...(target?.querySelectorAll('[data-panel-section]') ?? [])];
		expect(sections.map((section) => section.getAttribute('data-panel-section'))).toEqual([
			'design/fill',
			'design/stroke'
		]);
		expect(text()).toContain('Fill body');
		expect(text()).not.toContain('prototype body');
	});

	it('clicking a tab shows it, and the active tab can be switched by command', async () => {
		const { ctx } = await renderRightSidebar();
		target?.querySelector<HTMLElement>('[data-panel-tab="prototype"]')?.click();
		flushSync();
		expect(text()).toContain('prototype body');
		expect(text()).not.toContain('Fill body');
		await ctx.commands.run('panels.show.design');
		flushSync();
		expect(text()).toContain('Fill body');
	});

	it('collapsing a section hides its body and sets aria-expanded', async () => {
		await renderRightSidebar();
		const header = target?.querySelector<HTMLElement>(
			'[data-panel-section="design/fill"] button[aria-expanded]'
		);
		expect(header?.getAttribute('aria-expanded')).toBe('true');
		header?.click();
		flushSync();
		expect(header?.getAttribute('aria-expanded')).toBe('false');
		expect(text()).not.toContain('Fill body');
		expect(text()).toContain('Stroke body');
	});

	it('renders nothing for a side without tabs', async () => {
		const { ctx } = await renderRightSidebar();
		await unmount(host as ReturnType<typeof mount>);
		host = mount(HostRoot, { target: target as HTMLElement, props: { ctx, region: 'left' } });
		flushSync();
		expect(target?.querySelector('[data-panels-sidebar]')).toBeNull();
	});
});
