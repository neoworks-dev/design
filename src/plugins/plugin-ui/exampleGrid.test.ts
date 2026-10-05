// The bundled example plugin (plugins/example-grid), loaded from disk and run through the real
// worker runtime, the plugin API and the declarative UI: proves a third-party plugin written
// against the public API works end to end, commands and panel alike.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { inlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginUiProviders
} from '../../lib/plugins/fixtures/pluginFixture';
import { parseManifest } from '../../lib/plugins/manifest';
import pluginUi from './index';

const directory = path.join(process.cwd(), 'plugins', 'example-grid');
const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const source = readFileSync(path.join(directory, 'main.js'), 'utf8');

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
	await new Promise((resolve) => setTimeout(resolve, 30));
	flushSync();
}

async function mountExample(): Promise<{
	ctx: Context;
	workers: ReturnType<typeof inlineWorkers>;
}> {
	const workers = inlineWorkers();
	const list = listOf(discovered(manifest, { source: 'builtin', directoryName: 'example-grid' }));
	mounted = await mountPlugin(pluginUi, {
		providers: pluginUiProviders(workers.factory),
		desktop: { plugins: fakePluginsSection(() => list, { 'builtin/example-grid/main.js': source }) }
	});
	await settle();
	return { ctx: mounted.ctx, workers };
}

describe('example plugin: Grid Maker', () => {
	it('has a valid manifest', () => {
		expect(parseManifest(manifest).ok).toBe(true);
	});

	it('makes a grid in one undo step and removes it again', async () => {
		const { ctx, workers } = await mountExample();
		expect(ctx.commands.has('example-grid.make-grid')).toBe(true);
		expect(workers.created).toEqual([]);

		const nodesBefore = ctx.document.query(() => true).length;
		const stepsBefore = ctx.history.entries.length;
		await ctx.commands.run('example-grid.make-grid');

		const grid = ctx.document.query((node) => node.name === 'Grid')[0];
		expect(ctx.document.children(grid.id)).toHaveLength(12);
		expect([...ctx.selection.ids]).toEqual([grid.id]);
		expect(ctx.history.entries).toHaveLength(stepsBefore + 1);
		expect(ctx.history.undoLabel).toBe('Grid Maker: Make grid');

		ctx.history.undo();
		expect(ctx.document.query(() => true)).toHaveLength(nodesBefore);
		ctx.history.redo();

		await ctx.commands.run('example-grid.clear-grids');
		expect(ctx.document.query((node) => node.name === 'Grid')).toEqual([]);
	});

	it('shows its panel, builds a grid from the panel button and keeps the panel in step', async () => {
		const { ctx } = await mountExample();
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'left' } });
		ctx.panels.activateTab('example-grid.panel');
		await settle();
		const panel = (): string =>
			target?.querySelector('[data-plugin-surface]')?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(panel()).toContain('0 grid(s) on this page');
		expect(panel()).toContain('Make 4 x 3 grid');

		const columns = target.querySelector<HTMLInputElement>('input[type="number"]');
		if (columns === null) throw new Error('no columns field');
		columns.value = '6';
		columns.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(panel()).toContain('Make 6 x 3 grid');

		const stepsBefore = ctx.history.entries.length;
		const make = [...target.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Make 6 x 3 grid')
		);
		make?.click();
		await settle();

		const grid = ctx.document.query((node) => node.name === 'Grid')[0];
		expect(ctx.document.children(grid.id)).toHaveLength(18);
		expect(ctx.history.entries).toHaveLength(stepsBefore + 1);
		expect(ctx.history.undoLabel).toBe('Make 6 x 3 grid');
		expect(panel()).toContain('1 grid(s) on this page, 1 layer(s) selected');

		ctx.history.undo();
		await settle();
		expect(panel()).toContain('0 grid(s) on this page');
	});
});
