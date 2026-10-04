import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import coreCommands from '../../plugins/core-commands';
import coreContextKeys from '../../plugins/core-context-keys';
import coreKeymap from '../../plugins/core-keymap';
import historyPlugin from '../../plugins/history';
import selectionPlugin from '../../plugins/selection';
import { mountPlugin, type MountedPlugin } from '../kernel/testing';
import { LastPageError } from './document';
import { documentWith, sampleDocument } from './fixtures/documentFixture';

// n1 page A: n2 F (n3, n4, n5 G (n6)) ; n7 page B: n8
async function mount(): Promise<MountedPlugin> {
	const keymap: Plugin.Object = {
		...coreKeymap,
		apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' })
	};
	return mountPlugin(historyPlugin, {
		providers: [
			coreContextKeys,
			coreCommands,
			keymap,
			documentWith(sampleDocument()),
			selectionPlugin
		]
	});
}

function pageNames(mounted: MountedPlugin): string[] {
	return mounted.ctx.document.pages().map((page) => page.name);
}

describe('create', () => {
	it('adds "Page N" at the end, makes it current, and undo removes it', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		const id = document.createPage();
		expect(pageNames(mounted)).toEqual(['A', 'B', 'Page 3']);
		expect(document.currentPageId).toBe(id);
		expect(history.entries.map((entry) => entry.label)).toEqual(['Create page']);

		history.undo();
		expect(pageNames(mounted)).toEqual(['A', 'B']);
		expect(document.currentPageId).toBe('n1');
		history.redo();
		expect(pageNames(mounted)).toEqual(['A', 'B', 'Page 3']);
		await mounted.cleanup();
	});

	it('skips names already taken and accepts an explicit name', async () => {
		const mounted = await mount();
		const { document } = mounted.ctx;
		document.createPage('Page 3');
		document.createPage();
		document.createPage('  Cover  ');
		expect(pageNames(mounted)).toEqual(['A', 'B', 'Page 3', 'Page 4', 'Cover']);
		await mounted.cleanup();
	});
});

describe('rename and reorder', () => {
	it('rename is undoable and rejects an empty name', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		document.renamePage('n7', '  Flows ');
		expect(document.get('n7')).toMatchObject({ name: 'Flows' });
		expect(() => document.renamePage('n7', '   ')).toThrow(/needs a name/);
		expect(() => document.renamePage('n2', 'nope')).toThrow(/not a page/);
		history.undo();
		expect(document.get('n7')).toMatchObject({ name: 'B' });
		await mounted.cleanup();
	});

	it('reorder moves a page and undo restores the order', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		document.createPage('C');
		document.reorderPage('n7', 0);
		expect(pageNames(mounted)).toEqual(['B', 'A', 'C']);
		document.reorderPage('n1', 2);
		expect(pageNames(mounted)).toEqual(['B', 'C', 'A']);
		history.undo();
		history.undo();
		expect(pageNames(mounted)).toEqual(['A', 'B', 'C']);
		await mounted.cleanup();
	});
});

describe('duplicate', () => {
	it('copies the whole page with fresh ids and undo removes the copy', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		const copyId = document.duplicatePage('n1');
		expect(pageNames(mounted)).toEqual(['A', 'A copy', 'B']);
		expect(document.currentPageId).toBe(copyId);
		const original = document.descendants('n1').map((node) => node.name);
		const copied = document.descendants(copyId).map((node) => node.name);
		expect(copied).toEqual(original);
		const originalIds = new Set(document.descendants('n1').map((node) => node.id));
		expect(document.descendants(copyId).some((node) => originalIds.has(node.id))).toBe(false);

		history.undo();
		expect(pageNames(mounted)).toEqual(['A', 'B']);
		expect(Object.keys(document.snapshot.nodes)).toHaveLength(8);
		await mounted.cleanup();
	});
});

describe('delete', () => {
	it('removes the page and its nodes, moves to a neighbour, and undo brings it back', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		document.deletePage('n1');
		expect(pageNames(mounted)).toEqual(['B']);
		expect(document.has('n3')).toBe(false);
		expect(document.currentPageId).toBe('n7');
		history.undo();
		expect(pageNames(mounted)).toEqual(['A', 'B']);
		expect(document.has('n6')).toBe(true);
		await mounted.cleanup();
	});

	it('prevents deleting the last page', async () => {
		const mounted = await mount();
		const { document } = mounted.ctx;
		document.deletePage('n7');
		expect(() => document.deletePage('n1')).toThrow(LastPageError);
		expect(pageNames(mounted)).toEqual(['A']);
		await mounted.cleanup();
	});

	it('deleting a page that is not current leaves the current page alone', async () => {
		const mounted = await mount();
		const { document } = mounted.ctx;
		document.deletePage('n7');
		expect(document.currentPageId).toBe('n1');
		await mounted.cleanup();
	});
});

describe('current page, viewport and selection', () => {
	it('restores viewport and selection on page switch and emits currentpagechange', async () => {
		const mounted = await mount();
		const { document, selection } = mounted.ctx;
		const changes: Array<[string, string | null]> = [];
		mounted.ctx.on('document/currentpagechange', (pageId, previous) =>
			changes.push([pageId, previous])
		);

		selection.select(['n3']);
		document.setPageViewport('n1', { x: 40, y: -20, zoom: 2 });
		document.setCurrentPage('n7');
		expect(selection.ids).toEqual([]);
		expect(document.getPageViewport('n7')).toEqual({ x: 0, y: 0, zoom: 1 });
		document.setPageViewport('n7', { x: 5, y: 5, zoom: 0.5 });

		document.setCurrentPage('n1');
		expect(selection.ids).toEqual(['n3']);
		expect(document.getPageViewport('n1')).toEqual({ x: 40, y: -20, zoom: 2 });
		expect(document.getPageViewport('n7')).toEqual({ x: 5, y: 5, zoom: 0.5 });
		expect(changes).toEqual([
			['n7', 'n1'],
			['n1', 'n7']
		]);

		document.setCurrentPage('n1');
		expect(changes).toHaveLength(2);
		expect(() => document.setCurrentPage('n2')).toThrow(/not a page/);
		await mounted.cleanup();
	});

	it('page switches are not history entries', async () => {
		const mounted = await mount();
		mounted.ctx.document.setCurrentPage('n7');
		expect(mounted.ctx.history.entries).toEqual([]);
		await mounted.cleanup();
	});

	it('the page background is a property of the page node and undoable', async () => {
		const mounted = await mount();
		const { document, history } = mounted.ctx;
		document.setPageBackground('n1', { r: 0.1, g: 0.2, b: 0.3 });
		const page = document.currentPage;
		expect(page.backgrounds[0]).toMatchObject({ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 } });
		history.undo();
		expect(document.currentPage.backgrounds[0]).toMatchObject({
			color: { r: 0.96, g: 0.96, b: 0.96 }
		});
		await mounted.cleanup();
	});

	it('ensurePageLoaded resolves for a page and rejects a node that is not a page', async () => {
		const mounted = await mount();
		await expect(mounted.ctx.document.ensurePageLoaded('n1')).resolves.toBeUndefined();
		expect(() => mounted.ctx.document.ensurePageLoaded('n2')).toThrow(/not a page/);
		await mounted.cleanup();
	});
});

describe('commands', () => {
	it('page.create, page.rename, page.duplicate, page.reorder, page.switch and page.delete', async () => {
		const mounted = await mount();
		const { commands, document } = mounted.ctx;
		await commands.run('page.create', { name: 'Home' });
		expect(pageNames(mounted)).toEqual(['A', 'B', 'Home']);
		await commands.run('page.rename', { name: 'Landing' });
		expect(pageNames(mounted)).toEqual(['A', 'B', 'Landing']);
		await commands.run('page.reorder', { position: 0 });
		expect(pageNames(mounted)).toEqual(['Landing', 'A', 'B']);
		await commands.run('page.switch', { pageId: 'n1' });
		expect(document.currentPageId).toBe('n1');
		await commands.run('page.duplicate');
		expect(pageNames(mounted)).toEqual(['Landing', 'A', 'A copy', 'B']);
		await commands.run('page.delete');
		expect(pageNames(mounted)).toEqual(['Landing', 'A', 'B']);
		await expect(commands.run('page.rename', {})).rejects.toThrow(/"name"/);
		await mounted.cleanup();
	});

	it('page.delete refuses the last page', async () => {
		const mounted = await mount();
		const { commands } = mounted.ctx;
		await commands.run('page.delete', { pageId: 'n7' });
		await expect(commands.run('page.delete')).rejects.toThrow(LastPageError);
		await mounted.cleanup();
	});
});
