import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import pagesPanel from './index';

const storage = { getItem: (): null => null, setItem: (): void => {} };

const panels: Plugin = {
	...corePanels,
	apply: (ctx: Context) => corePanels.apply(ctx, { storage })
};

// Each test gets its own document: edits must not leak between tests.
function freshProviders(): Plugin[] {
	return [...editingProviders(), panels];
}

function names(ctx: Context): string[] {
	return ctx.pagesPanel.pages().map((page) => page.name);
}

describePlugin('pages-panel', pagesPanel, {
	providers: freshProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.sectionRegistry.get('file/pages')).toBeDefined();
		expect(ctx.commands.has('pages.rename')).toBe(true);
		expect(ctx.menus.has('context/page')).toBe(true);
		expect(ctx.contextKeys.get('multiplePages')).toBe(false);
	}
});

describe('pages panel actions', () => {
	it('adds "Page N", switches to it and undoes', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		const first = ctx.document.currentPageId;
		ctx.pagesPanel.add();
		expect(names(ctx)).toEqual(['Page', 'Page 2']);
		expect(ctx.document.currentPageId).not.toBe(first);
		ctx.history.undo();
		expect(names(ctx)).toEqual(['Page']);
		await cleanup();
	});

	it('switches the current page', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		const first = ctx.document.currentPageId;
		ctx.pagesPanel.add();
		ctx.pagesPanel.switchTo(first);
		expect(ctx.document.currentPageId).toBe(first);
		await cleanup();
	});

	it('renames on commit, keeps the name on cancel or empty, and undoes', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		const id = ctx.document.currentPageId;
		ctx.pagesPanel.startRename(id);
		ctx.pagesPanel.commitRename('Cover');
		expect(names(ctx)).toEqual(['Cover']);
		ctx.pagesPanel.startRename(id);
		ctx.pagesPanel.stopRename();
		ctx.pagesPanel.startRename(id);
		ctx.pagesPanel.commitRename('  ');
		expect(names(ctx)).toEqual(['Cover']);
		ctx.history.undo();
		expect(names(ctx)).toEqual(['Page']);
		await cleanup();
	});

	it('reorders by dragging as one undo step', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		ctx.pagesPanel.add();
		ctx.pagesPanel.add();
		expect(names(ctx)).toEqual(['Page', 'Page 2', 'Page 3']);
		const [first] = ctx.pagesPanel.pages();
		const entries = ctx.history.entries.length;
		ctx.pagesPanel.beginDrag(first.id);
		ctx.pagesPanel.updateDrag(3 * 28);
		expect(ctx.pagesPanel.drag).toMatchObject({ slot: 3, position: 2 });
		expect(ctx.pagesPanel.commitDrag()).toBe(true);
		expect(names(ctx)).toEqual(['Page 2', 'Page 3', 'Page']);
		expect(ctx.history.entries.length).toBe(entries + 1);
		ctx.history.undo();
		expect(names(ctx)).toEqual(['Page', 'Page 2', 'Page 3']);
		await cleanup();
	});

	it('a drop where the page already is changes nothing', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		ctx.pagesPanel.add();
		const [first] = ctx.pagesPanel.pages();
		ctx.pagesPanel.beginDrag(first.id);
		ctx.pagesPanel.updateDrag(0);
		expect(ctx.pagesPanel.commitDrag()).toBe(false);
		await cleanup();
	});
});

describe('page context menu', () => {
	it('duplicates and deletes through its commands, undoable', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		const id = ctx.document.currentPageId;
		await ctx.commands.run('pages.duplicate', { pageId: id });
		expect(names(ctx)).toEqual(['Page', 'Page copy']);
		await ctx.commands.run('pages.delete', { pageId: id });
		expect(names(ctx)).toEqual(['Page copy']);
		ctx.history.undo();
		expect(names(ctx)).toEqual(['Page', 'Page copy']);
		await cleanup();
	});

	it('lists rename, duplicate and delete, and disables delete on the last page', async () => {
		const { ctx, cleanup } = await mountPlugin(pagesPanel, { providers: freshProviders() });
		const items = ctx.menus.resolve('context/page');
		expect(items.map((item) => item.title)).toEqual(['Rename', 'Duplicate', 'Delete']);
		expect(items[2].enabled).toBe(false);
		ctx.pagesPanel.add();
		expect(ctx.menus.resolve('context/page')[2].enabled).toBe(true);
		await cleanup();
	});
});
