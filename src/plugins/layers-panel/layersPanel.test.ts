import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import layersPanel from './index';

const storage = { getItem: (): null => null, setItem: (): void => {} };

const panels: Plugin = {
	...corePanels,
	apply: (ctx: Context) => corePanels.apply(ctx, { storage })
};

const contextMenusFake: Plugin = {
	name: 'context-menus-fake',
	apply(ctx: Context): void {
		ctx.provide('contextMenus', {});
	}
};

// page p: f [a, b, c], loose
const providers = [...editingProviders(), panels, contextMenusFake];

function rowIds(ctx: Context): string[] {
	return ctx.layers.rows().map((row) => row.id);
}

describePlugin('layers-panel', layersPanel, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('file/layers')).toBeDefined();
		expect(ctx.commands.has('layers.collapse-all')).toBe(true);
		expect(ctx.layers).toBeDefined();
	}
});

describe('layers service', () => {
	it('lists the page top-most first and shows children once expanded', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers });
		expect(rowIds(ctx)).toEqual(['loose', 'f']);
		ctx.layers.setExpanded('f', true);
		expect(rowIds(ctx)).toEqual(['loose', 'f', 'c', 'b', 'a']);
		ctx.layers.collapseAll();
		expect(rowIds(ctx)).toEqual(['loose', 'f']);
		await cleanup();
	});

	it('Alt+click on a chevron expands every container below', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers });
		ctx.layers.toggleExpandedDeep('f');
		expect(ctx.layers.isExpanded('f')).toBe(true);
		ctx.layers.toggleExpandedDeep('f');
		expect(ctx.layers.isExpanded('f')).toBe(false);
		await cleanup();
	});

	it('reveals the ancestors of a selected node', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers });
		ctx.layers.reveal(['b']);
		expect(rowIds(ctx)).toContain('b');
		await cleanup();
	});

	it('plain click replaces, Ctrl+click toggles, Shift+click selects the range', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers });
		ctx.layers.setExpanded('f', true);
		// rows: loose, f, c, b, a
		ctx.layers.clickRow('c', { shiftKey: false, toggleKey: false });
		expect(ctx.selection.ids).toEqual(['c']);
		ctx.layers.clickRow('a', { shiftKey: true, toggleKey: false });
		expect([...ctx.selection.ids].sort()).toEqual(['a', 'b', 'c']);
		ctx.layers.clickRow('loose', { shiftKey: false, toggleKey: true });
		expect(ctx.selection.has('loose')).toBe(true);
		ctx.layers.clickRow('loose', { shiftKey: false, toggleKey: true });
		expect(ctx.selection.has('loose')).toBe(false);
		await cleanup();
	});
});
