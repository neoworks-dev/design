// The bundled example plugin (plugins/example-grid), loaded from disk and run through the real
// worker runtime: proves a third-party plugin written against the public API works end to end.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { inlineWorkers } from '../../lib/plugins/fixtures/inlineWorker';
import {
	discovered,
	fakePluginsSection,
	listOf,
	pluginApiProviders
} from '../../lib/plugins/fixtures/pluginFixture';
import { parseManifest } from '../../lib/plugins/manifest';
import pluginApi from './index';

const directory = path.join(process.cwd(), 'plugins', 'example-grid');
const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const source = readFileSync(path.join(directory, 'main.js'), 'utf8');

let mounted: MountedPlugin | undefined;
afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('example plugin: Grid Maker', () => {
	it('has a valid manifest', () => {
		expect(parseManifest(manifest).ok).toBe(true);
	});

	it('makes a grid in one undo step and removes it again', async () => {
		const workers = inlineWorkers();
		const list = listOf(discovered(manifest, { source: 'builtin', directoryName: 'example-grid' }));
		mounted = await mountPlugin(pluginApi, {
			providers: pluginApiProviders(workers.factory),
			desktop: {
				plugins: fakePluginsSection(() => list, { 'builtin/example-grid/main.js': source })
			}
		});
		await settle();
		const { ctx } = mounted;
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
});
