import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { inlineWorkers, type InlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginUiProviders,
	validManifest
} from '../../lib/plugins/fixtures/pluginFixture';
import pluginUi from './index';

const PANEL_SOURCE = `
	let clicks = 0;
	const view = () => ({
		type: 'stack',
		children: [
			{ type: 'text', text: 'Clicked ' + clicks + ' times' },
			{ type: 'input', label: 'Name', value: 'x', onChange: (value) => design.log.info('name', value) },
			{ type: 'checkbox', label: 'Tidy', checked: false, onChange: (value) => design.log.info('tidy', value) },
			{
				type: 'button',
				label: 'Add rectangle',
				onClick: async () => {
					clicks += 1;
					await design.document.createNode('RECTANGLE', { name: 'From UI' });
					await render();
				}
			}
		]
	});
	async function render() { await design.ui.set('example.panel', view()); }
	await render();
`;

let workers: InlineWorkers = inlineWorkers();
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

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 25));
	flushSync();
}

function manifestWith(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return validManifest({
		permissions: ['document:read', 'document:write', 'selection', 'ui:panel'],
		contributes: {
			panels: [{ id: 'example.panel', title: 'Example', side: 'right' }]
		},
		...extra
	});
}

async function mountUi(source: string, manifest = manifestWith()): Promise<Context> {
	workers = inlineWorkers();
	const list = listOf(discovered(manifest));
	mounted = await mountPlugin(pluginUi, {
		providers: pluginUiProviders(workers.factory),
		desktop: { plugins: fakePluginsSection(() => list, { 'user/example/main.js': source }) }
	});
	await settle();
	return mounted.ctx;
}

function render(ctx: Context, region: string): HTMLElement {
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region } });
	flushSync();
	return target;
}

function surfaceText(root: HTMLElement): string {
	return root.querySelector('[data-plugin-surface]')?.textContent?.replace(/\s+/g, ' ') ?? '';
}

describePlugin('plugin-ui', pluginUi, {
	providers: pluginUiProviders(inlineWorkers().factory),
	desktop: { plugins: fakePluginsSection(() => listOf()) },
	contributes: ({ ctx }) => {
		expect(ctx.pluginUi).toBeDefined();
		expect(ctx.regions.contributions('overlay').map((entry) => entry.id)).toContain(
			'plugin-ui/modals'
		);
		expect(ctx.pluginHost.snapshotState().apis).toContain('ui');
	}
});

describe('plugin-ui panels', () => {
	it('registers the panel tab as a stub and starts the plugin only when it is shown', async () => {
		const ctx = await mountUi(PANEL_SOURCE);
		expect(ctx.panels.getTab('example.panel')?.title).toBe('Example');
		expect(workers.created).toEqual([]);

		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		flushSync();
		expect(surfaceText(root)).toContain('Starting plugin');
		await settle();
		expect(workers.created).toHaveLength(1);
		expect(surfaceText(root)).toContain('Clicked 0 times');
		expect(root.querySelector('input[type="text"]')).not.toBeNull();
		expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
	});

	it('round-trips events: a click runs the plugin handler, which edits and patches the UI', async () => {
		const ctx = await mountUi(PANEL_SOURCE);
		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();
		const before = ctx.document.childNodes(ctx.document.currentPageId).length;
		const stepsBefore = ctx.history.entries.length;

		const button = [...root.querySelectorAll('button')].find(
			(candidate) => candidate.textContent?.trim() === 'Add rectangle'
		);
		button?.click();
		await settle();

		expect(surfaceText(root)).toContain('Clicked 1 times');
		expect(ctx.document.childNodes(ctx.document.currentPageId)).toHaveLength(before + 1);
		expect(ctx.history.entries).toHaveLength(stepsBefore + 1);
		expect(ctx.history.undoLabel).toBe('Add rectangle');
		// One full tree, then a patch: version 2.
		expect(ctx.pluginUi.surface('example', 'example.panel')?.version).toBe(2);

		ctx.history.undo();
		expect(ctx.document.childNodes(ctx.document.currentPageId)).toHaveLength(before);
	});

	it('sends input and checkbox values back to their handlers', async () => {
		const ctx = await mountUi(PANEL_SOURCE);
		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();

		const input = root.querySelector<HTMLInputElement>('input[type="text"]');
		if (input === null) throw new Error('no text input');
		input.value = 'Hero';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
		if (checkbox === null) throw new Error('no checkbox');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();

		const lines = ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message);
		expect(lines).toEqual(['name Hero', 'tidy true']);
	});

	it('rejects a tree with an unknown node type and keeps showing the last good one', async () => {
		const source = `
			await design.ui.set('example.panel', { type: 'text', text: 'good' });
			try {
				await design.ui.set('example.panel', { type: 'stack', children: [{ type: 'iframe', src: 'x' }] });
				design.log.info('accepted');
			} catch (error) {
				design.log.info('rejected: ' + error.message);
			}
		`;
		const ctx = await mountUi(source);
		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe(
			'rejected: surface "example.panel": unknown node type "iframe" at children[0]'
		);
		expect(surfaceText(root)).toBe('good');
	});

	it('falls back to a full tree when a patch does not fit the host`s copy', async () => {
		const source = `
			await design.ui.set('example.panel', { type: 'text', text: 'one' });
			await design.ui.set('example.panel', { type: 'text', text: 'two' });
		`;
		const ctx = await mountUi(source);
		render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();
		expect(ctx.pluginUi.surface('example', 'example.panel')?.version).toBe(2);
	});

	it('shows why a plugin that failed to start has no surface', async () => {
		const ctx = await mountUi("throw new Error('cannot start');");
		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();
		expect(root.querySelector('[role="alert"]')?.textContent).toContain('cannot start');
	});

	it('removes the surfaces when the plugin stops, the tab stays', async () => {
		const ctx = await mountUi(PANEL_SOURCE);
		const root = render(ctx, 'right');
		ctx.panels.activateTab('example.panel');
		await settle();
		expect(ctx.pluginUi.surface('example', 'example.panel')).toBeDefined();

		await ctx.pluginHost.deactivate('example');
		await settle();
		expect(ctx.pluginUi.surface('example', 'example.panel')).toBeUndefined();
		expect(ctx.panels.getTab('example.panel')).toBeDefined();
		expect(surfaceText(root)).toContain('Starting plugin');
	});
});

describe('plugin-ui modals', () => {
	const MODAL_SOURCE = `
		design.on('uiclose', (event) => design.log.info('closed', event.surface));
		await design.ui.set('example.dialog', {
			type: 'stack',
			children: [{ type: 'text', text: 'Are you sure?' }, { type: 'button', label: 'Yes', onClick: () => design.log.info('yes') }]
		});
		await design.ui.showModal('example.dialog', { title: 'Confirm', width: 300 });
	`;

	it('shows a modal with its surface, runs its handlers and closes it', async () => {
		const ctx = await mountUi(MODAL_SOURCE, manifestWith({ contributes: {} }));
		await ctx.pluginHost.activate('example');
		const root = render(ctx, 'overlay');
		await settle();
		const dialog = root.querySelector('[role="dialog"]');
		expect(dialog?.getAttribute('aria-label')).toBe('Confirm');
		expect(dialog?.textContent).toContain('Are you sure?');

		const yes = [...(dialog?.querySelectorAll('button') ?? [])].find(
			(candidate) => candidate.textContent?.trim() === 'Yes'
		);
		yes?.click();
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.map((line) => line.message)).toEqual([
			'yes'
		]);

		root.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
		await settle();
		expect(root.querySelector('[role="dialog"]')).toBeNull();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toBe(
			'closed example.dialog'
		);
	});

	it('hides, shows and resizes a modal from the plugin', async () => {
		const source = `
			await design.ui.set('example.dialog', { type: 'text', text: 'hi' });
			await design.ui.showModal('example.dialog', { title: 'Hi' });
			await design.ui.resize('example.dialog', { width: 500, height: 300 });
			await design.ui.hide('example.dialog');
			await design.ui.show('example.dialog');
		`;
		const ctx = await mountUi(source, manifestWith({ contributes: {} }));
		await ctx.pluginHost.activate('example');
		await settle();
		const entry = ctx.pluginUi.surface('example', 'example.dialog');
		expect(entry?.visible).toBe(true);
		expect(entry?.modal).toEqual({ title: 'Hi', width: 500, height: 300 });
		expect(ctx.pluginUi.openModals()).toHaveLength(1);
	});
});

describe('plugin-ui inspector sections', () => {
	const INSPECTOR_MANIFEST = manifestWith({
		contributes: {
			inspectors: [{ id: 'example.section', title: 'Example', nodeTypes: ['RECTANGLE'] }]
		}
	});
	const INSPECTOR_SOURCE = `
		const render = async () => design.ui.set('example.section', {
			type: 'text', text: 'Selected ' + (await design.selection.get()).length
		});
		design.on('selectionchange', render);
		await render();
	`;

	it('shows the section only while the selection fits, filled by the plugin`s surface', async () => {
		const ctx = await mountUi(INSPECTOR_SOURCE, INSPECTOR_MANIFEST);
		ctx.panels.registerTab({ id: 'design', side: 'right', title: 'Design' });
		const root = render(ctx, 'right');
		expect(ctx.inspectors.activeIds()).toEqual([]);

		ctx.selection.select(['a']);
		flushSync();
		expect(ctx.inspectors.activeIds()).toContain('example.section');
		await settle();
		expect(
			root.querySelector('[data-panel-section="design/example.section"]')?.textContent
		).toContain('Selected 1');

		ctx.selection.select(['f']);
		flushSync();
		expect(ctx.inspectors.activeIds()).not.toContain('example.section');
	});

	it('registers an inspector section at run time and removes it with the plugin', async () => {
		const source = `
			await design.ui.registerInspector({ id: 'example.dynamic', title: 'Dynamic' });
			await design.ui.set('example.dynamic', { type: 'text', text: 'dynamic' });
		`;
		const ctx = await mountUi(source, manifestWith({ contributes: {} }));
		await ctx.pluginHost.activate('example');
		await settle();
		ctx.selection.select(['a']);
		expect(ctx.inspectors.activeIds()).toContain('example.dynamic');
		await ctx.pluginHost.deactivate('example');
		expect(ctx.inspectors.registry.has('example.dynamic')).toBe(false);
	});
});

describe('plugin-ui permissions', () => {
	it('refuses ui calls without the ui:panel permission', async () => {
		const source = `
			try { await design.ui.set('example.panel', { type: 'text', text: 'x' }); design.log.info('allowed'); }
			catch (error) { design.log.info(error.message); }
		`;
		const ctx = await mountUi(source, manifestWith({ permissions: ['document:read'] }));
		await ctx.pluginHost.activate('example');
		await settle();
		expect(ctx.pluginHost.connectionOf('example')?.logs.at(-1)?.message).toContain(
			'did not declare the "ui:panel" permission'
		);
	});
});
