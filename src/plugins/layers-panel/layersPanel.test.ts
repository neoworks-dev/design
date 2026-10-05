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
// Each test gets its own document: edits must not leak between tests.
function freshProviders(): Plugin[] {
	return [...editingProviders(), panels, contextMenusFake];
}

function rowIds(ctx: Context): string[] {
	return ctx.layers.rows().map((row) => row.id);
}

describePlugin('layers-panel', layersPanel, {
	providers: freshProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('file/layers')).toBeDefined();
		expect(ctx.commands.has('layers.collapse-all')).toBe(true);
		expect(ctx.layers).toBeDefined();
	}
});

describe('layers service', () => {
	it('lists the page top-most first and shows children once expanded', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		expect(rowIds(ctx)).toEqual(['loose', 'f']);
		ctx.layers.setExpanded('f', true);
		expect(rowIds(ctx)).toEqual(['loose', 'f', 'c', 'b', 'a']);
		ctx.layers.collapseAll();
		expect(rowIds(ctx)).toEqual(['loose', 'f']);
		await cleanup();
	});

	it('Alt+click on a chevron expands every container below', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.toggleExpandedDeep('f');
		expect(ctx.layers.isExpanded('f')).toBe(true);
		ctx.layers.toggleExpandedDeep('f');
		expect(ctx.layers.isExpanded('f')).toBe(false);
		await cleanup();
	});

	it('reveals the ancestors of a selected node', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.reveal(['b']);
		expect(rowIds(ctx)).toContain('b');
		await cleanup();
	});

	it('plain click replaces, Ctrl+click toggles, Shift+click selects the range', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
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

describe('dragging layers', () => {
	// rows with f expanded: 0 loose, 1 f, 2 c, 3 b, 4 a; each row is 28px high
	const rowTop = (index: number): number => index * 28;

	it('nests onto a container row as one undo step', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setExpanded('f', true);
		expect(ctx.layers.beginDrag('loose')).toBe(true);
		ctx.layers.updateDrag(rowTop(1) + 14, 0);
		expect(ctx.layers.drag?.drop?.indicator).toEqual({ kind: 'inside', rowId: 'f' });
		const before = ctx.history.entries.length;
		expect(ctx.layers.commitDrag()).toBe(true);
		expect(ctx.document.get('loose')?.parentId).toBe('f');
		expect(ctx.document.children('f').at(-1)).toBe('loose');
		expect(ctx.history.entries.length).toBe(before + 1);
		ctx.history.undo();
		expect(ctx.document.get('loose')?.parentId).toBe('p');
		await cleanup();
	});

	it('reorders between rows', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setExpanded('f', true);
		ctx.layers.beginDrag('a');
		// the top edge of row c: above c
		ctx.layers.updateDrag(rowTop(2) + 2, 1);
		expect(ctx.layers.commitDrag()).toBe(true);
		expect(ctx.document.children('f')).toEqual(['b', 'c', 'a']);
		await cleanup();
	});

	it('moves every selected layer together', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setExpanded('f', true);
		ctx.selection.select(['a', 'b']);
		ctx.layers.beginDrag('b');
		expect(ctx.layers.drag?.ids).toEqual(['a', 'b']);
		ctx.layers.updateDrag(rowTop(0) + 2, 0);
		ctx.layers.commitDrag();
		expect(ctx.document.children('p').slice(-2)).toEqual(['a', 'b']);
		await cleanup();
	});

	it('refuses a drop into the dragged layer, and Esc-style cancel changes nothing', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setExpanded('f', true);
		ctx.layers.beginDrag('f');
		ctx.layers.updateDrag(rowTop(1) + 14, 0);
		expect(ctx.layers.drag?.drop).toBeNull();
		expect(ctx.layers.commitDrag()).toBe(false);
		ctx.layers.beginDrag('c');
		ctx.layers.updateDrag(rowTop(0) + 2, 0);
		ctx.layers.cancelDrag();
		expect(ctx.layers.drag).toBeNull();
		expect(ctx.document.get('c')?.parentId).toBe('f');
		await cleanup();
	});
});

describe('visibility and lock', () => {
	it('toggles through the document and undoes', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.toggleFlag('loose', 'visible', false);
		expect(Reflect.get(ctx.document.require('loose'), 'visible')).toBe(false);
		ctx.layers.toggleFlag('loose', 'locked', false);
		expect(Reflect.get(ctx.document.require('loose'), 'locked')).toBe(true);
		ctx.history.undo();
		ctx.history.undo();
		expect(Reflect.get(ctx.document.require('loose'), 'visible')).toBe(true);
		expect(Reflect.get(ctx.document.require('loose'), 'locked')).toBe(false);
		await cleanup();
	});

	it('Alt isolates among siblings as one undo step', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		const before = ctx.history.entries.length;
		ctx.layers.toggleFlag('b', 'visible', true);
		expect(ctx.history.entries.length).toBe(before + 1);
		expect(Reflect.get(ctx.document.require('a'), 'visible')).toBe(false);
		ctx.history.undo();
		expect(Reflect.get(ctx.document.require('a'), 'visible')).toBe(true);
		await cleanup();
	});
});

describe('rename', () => {
	it('starts from node.rename, commits on Enter and undoes', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.emit('node-commands/rename-request', 'b');
		expect(ctx.layers.renamingId).toBe('b');
		expect(rowIds(ctx)).toContain('b');
		ctx.layers.commitRename('Hero', 0);
		expect(ctx.document.require('b').name).toBe('Hero');
		expect(ctx.layers.renamingId).toBeNull();
		ctx.history.undo();
		expect(ctx.document.require('b').name).toBe('b');
		await cleanup();
	});

	it('cancel and empty names keep the old name', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.startRename('a');
		ctx.layers.stopRename();
		expect(ctx.layers.renamingId).toBeNull();
		ctx.layers.startRename('a');
		ctx.layers.commitRename('   ', 0);
		expect(ctx.document.require('a').name).toBe('a');
		await cleanup();
	});

	it('Tab commits and moves to the next layer down, Shift+Tab to the previous', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setExpanded('f', true);
		// rows: loose, f, c, b, a
		ctx.layers.startRename('c');
		ctx.layers.commitRename('C2', 1);
		expect(ctx.document.require('c').name).toBe('C2');
		expect(ctx.layers.renamingId).toBe('b');
		ctx.layers.commitRename('b', -1);
		expect(ctx.layers.renamingId).toBe('c');
		await cleanup();
	});
});

describe('search and filter', () => {
	it('lists matches with their ancestors and drops the filter on close', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.openFilter();
		ctx.layers.setQuery('b');
		expect(rowIds(ctx)).toEqual(['f', 'b']);
		ctx.layers.setQuery('');
		ctx.layers.toggleType('frame');
		expect(rowIds(ctx)).toEqual(['f']);
		ctx.layers.closeFilter();
		expect(ctx.layers.filtering).toBe(false);
		expect(rowIds(ctx)).toEqual(['loose', 'f']);
		await cleanup();
	});

	it('does not drag while a filter is active', async () => {
		const { ctx, cleanup } = await mountPlugin(layersPanel, { providers: freshProviders() });
		ctx.layers.setQuery('b');
		expect(ctx.layers.beginDrag('b')).toBe(false);
		await cleanup();
	});
});
