import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import corePanels from '../../plugins/core-panels';
import coreRegions from '../../plugins/core-regions';
import PlaceholderText from '../../plugins/placeholder-shell/PlaceholderText.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import { PANEL_STORAGE_KEY, PanelState, type PanelStorage } from './panels.svelte';

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap];

function memoryStorage(initial?: string): PanelStorage & { value: string | null } {
	const storage = {
		value: initial === undefined ? null : initial,
		getItem: (): string | null => storage.value,
		setItem: (_key: string, value: string): void => {
			storage.value = value;
		}
	};
	return storage;
}

async function mountPanels(storage = memoryStorage()): Promise<MountedPlugin> {
	const consumer = {
		name: 'consumer',
		inject: ['panels', 'commands', 'keymap', 'contextKeys'],
		apply(): void {}
	};
	return mountPlugin(consumer, {
		providers: [...providers, { ...corePanels, apply: (ctx) => corePanels.apply(ctx, { storage }) }]
	});
}

function tabIds(mounted: MountedPlugin, side: 'left' | 'right'): string[] {
	return mounted.ctx.panels.tabs(side).map((tab) => tab.id);
}

describe('panels tabs', () => {
	it('registering a tab adds the tab, its show command and its shortcut; dispose removes all three', async () => {
		const mounted = await mountPanels();
		const { panels, commands, keymap } = mounted.ctx;
		const dispose = panels.registerTab({
			id: 'layers',
			side: 'left',
			title: 'Layers',
			shortcut: 'Alt+1',
			component: PlaceholderText
		});
		expect(tabIds(mounted, 'left')).toEqual(['layers']);
		expect(commands.has('panels.show.layers')).toBe(true);
		expect(keymap.lookupChords('panels.show.layers')).toEqual(['alt+1']);

		dispose();
		expect(tabIds(mounted, 'left')).toEqual([]);
		expect(commands.has('panels.show.layers')).toBe(false);
		expect(keymap.lookupChords('panels.show.layers')).toEqual([]);
		await mounted.cleanup();
	});

	it('the show command activates the tab and the shortcut runs it', async () => {
		const mounted = await mountPanels();
		const { panels, commands, keymap } = mounted.ctx;
		panels.registerTab({ id: 'a', side: 'left', title: 'A', order: 0 });
		panels.registerTab({ id: 'b', side: 'left', title: 'B', order: 1, shortcut: 'Alt+2' });
		expect(panels.activeTab('left')?.id).toBe('a');
		await commands.run('panels.show.b');
		expect(panels.activeTab('left')?.id).toBe('b');

		await commands.run('panels.show.a');
		keymap.handleKeydown({ key: '2', code: 'Digit2', altKey: true } as KeyboardEvent);
		expect(panels.activeTab('left')?.id).toBe('b');
		await mounted.cleanup();
	});

	it('activating a tab announces it so the layout can reveal the sidebar', async () => {
		const mounted = await mountPanels();
		const seen: unknown[][] = [];
		mounted.ctx.on('panels/tab-activated', (side, id) => void seen.push([side, id]));
		mounted.ctx.panels.registerTab({ id: 'design', side: 'right', title: 'Design' });
		mounted.ctx.panels.activateTab('design');
		expect(seen).toEqual([['right', 'design']]);
		await mounted.cleanup();
	});

	it('hides tabs with when, and falls back to the first visible tab', async () => {
		const mounted = await mountPanels();
		const { panels, contextKeys } = mounted.ctx;
		panels.registerTab({ id: 'design', side: 'right', title: 'Design', when: "mode == 'design'" });
		panels.registerTab({ id: 'inspect', side: 'right', title: 'Inspect', when: "mode == 'dev'" });
		panels.activateTab('inspect');
		expect(tabIds(mounted, 'right')).toEqual(['design']);
		expect(panels.activeTab('right')?.id).toBe('design');
		expect(contextKeys.get('mode')).toBe('design');

		await mounted.ctx.commands.run('panels.toggle-dev-mode');
		expect(contextKeys.get('mode')).toBe('dev');
		expect(tabIds(mounted, 'right')).toEqual(['inspect']);
		expect(panels.activeTab('right')?.id).toBe('inspect');
		await mounted.cleanup();
	});

	it('Shift+E switches between the Design and Prototype tabs', async () => {
		const mounted = await mountPanels();
		const { panels, commands } = mounted.ctx;
		panels.registerTab({ id: 'design', side: 'right', title: 'Design', order: 0 });
		panels.registerTab({ id: 'prototype', side: 'right', title: 'Prototype', order: 1 });
		await commands.run('panels.toggle-design-prototype');
		expect(panels.activeTab('right')?.id).toBe('prototype');
		await commands.run('panels.toggle-design-prototype');
		expect(panels.activeTab('right')?.id).toBe('design');
		expect(mounted.ctx.keymap.lookup('panels.toggle-design-prototype')).toBe('Shift+E');
		expect(mounted.ctx.keymap.lookup('panels.toggle-dev-mode')).toBe('Shift+D');
		await mounted.cleanup();
	});
});

describe('panels sections', () => {
	it('orders sections by order and hides them with when', async () => {
		const mounted = await mountPanels();
		const { panels, contextKeys } = mounted.ctx;
		const section = (id: string, order: number, when?: string): void => {
			panels.registerSection({
				tab: 'design',
				id,
				title: id,
				order,
				when,
				component: PlaceholderText
			});
		};
		section('stroke', 20);
		section('fill', 10);
		section('text', 5, 'hasText');
		expect(panels.sections('design').map((entry) => entry.id)).toEqual([
			'design/fill',
			'design/stroke'
		]);

		const unset = contextKeys.set('hasText', true);
		expect(panels.sections('design').map((entry) => entry.id)).toEqual([
			'design/text',
			'design/fill',
			'design/stroke'
		]);
		unset();
		expect(panels.sections('design')).toHaveLength(2);
		await mounted.cleanup();
	});

	it('dispose by identity: a stale disposer leaves the replacement section', async () => {
		const mounted = await mountPanels();
		const { panels } = mounted.ctx;
		const first = panels.registerSection({
			tab: 't',
			id: 's',
			title: 'First',
			component: PlaceholderText
		});
		panels.registerSection({ tab: 't', id: 's', title: 'Second', component: PlaceholderText });
		first();
		expect(panels.sections('t').map((entry) => entry.title)).toEqual(['Second']);
		await mounted.cleanup();
	});

	it('collapsed state is per section id, starts from the default and toggles', async () => {
		const mounted = await mountPanels();
		const { panels } = mounted.ctx;
		panels.registerSection({ tab: 't', id: 'a', title: 'A', component: PlaceholderText });
		panels.registerSection({
			tab: 't',
			id: 'b',
			title: 'B',
			component: PlaceholderText,
			collapsed: true
		});
		const [a, b] = panels.sections('t');
		expect([panels.isSectionCollapsed(a), panels.isSectionCollapsed(b)]).toEqual([false, true]);
		panels.toggleSection(a);
		panels.toggleSection(b);
		expect([panels.isSectionCollapsed(a), panels.isSectionCollapsed(b)]).toEqual([true, false]);
		await mounted.cleanup();
	});

	it('persists active tabs and collapsed sections and restores them', async () => {
		const storage = memoryStorage();
		const mounted = await mountPanels(storage);
		const { panels } = mounted.ctx;
		panels.registerTab({ id: 'a', side: 'left', title: 'A' });
		panels.registerTab({ id: 'b', side: 'left', title: 'B' });
		panels.registerSection({ tab: 'b', id: 's', title: 'S', component: PlaceholderText });
		panels.activateTab('b');
		panels.toggleSection(panels.sections('b')[0]);
		flushSync();
		expect(JSON.parse(storage.value ?? '{}')).toEqual({
			activeTabs: { left: 'b' },
			sectionStates: { 'b/s': true }
		});

		const restored = new PanelState(storage);
		expect(restored.activeTabs).toEqual({ left: 'b' });
		expect(restored.sectionStates).toEqual({ 'b/s': true });
		await mounted.cleanup();
	});

	it('ignores broken persisted data', () => {
		const state = new PanelState(memoryStorage('{"activeTabs": 4, "sectionStates": {"x": "no"}}'));
		expect(state.activeTabs).toEqual({});
		expect(state.sectionStates).toEqual({});
		expect(PANEL_STORAGE_KEY).toBe('panels/state');
	});
});

describePlugin('core-panels', corePanels, {
	providers,
	config: { storage: memoryStorage() },
	contributes: ({ ctx }) => {
		expect(ctx.panels).toBeDefined();
		expect(ctx.commands.has('panels.toggle-dev-mode')).toBe(true);
		expect(ctx.contextKeys.get('mode')).toBe('design');
		// no tabs registered: the sidebars contribute nothing visible
		expect(ctx.regions.contributions('left')).toHaveLength(0);
		expect(ctx.regions.contributions('right')).toHaveLength(0);
	}
});
