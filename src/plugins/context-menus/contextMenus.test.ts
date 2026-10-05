import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import type { NodeId } from '../../lib/document';
import duplicate from '../duplicate';
import grouping from '../grouping';
import nodeCommands from '../node-commands';
import zOrder from '../z-order';
import contextMenus from './index';

// Hit testing is a different plugin's job: this one answers with what the test sets.
const stack: { hits: NodeId[] } = { hits: [] };

const fakes: Plugin = {
	name: 'context-menu-fakes',
	apply(ctx: Context): void {
		ctx.provide('hitTest', {
			topAtScope: () => stack.hits[0],
			all: () => stack.hits
		});
		ctx.provide('viewport', { zoom: 1, screenToWorld: (point: { x: number; y: number }) => point });
		ctx.provide('renderer', { canvasElement: undefined });
	}
};

const providers = [...editingProviders(), fakes, duplicate, grouping, nodeCommands, zOrder];

function rightClick(x = 10, y = 20): MouseEvent {
	return new MouseEvent('contextmenu', { clientX: x, clientY: y, cancelable: true });
}

function titles(ctx: Context, menu: string): string[] {
	return ctx.menus.resolve(menu).map((item) => item.title);
}

describePlugin('context-menus', contextMenus, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.contextMenus).toBeDefined();
		expect(ctx.commands.has('context-menus.select-layer')).toBe(true);
		expect(ctx.menus.has('context/canvas')).toBe(true);
	}
});

describe('right click on the canvas', () => {
	it('selects the node under the cursor and opens the canvas menu', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		stack.hits = ['a'];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(ctx.selection.ids).toEqual(['a']);
		expect(ctx.menus.popup?.kind).toBe('canvas');
		expect(ctx.menus.popup?.target).toMatchObject({ world: { x: 10, y: 20 }, nodeId: 'a' });
		await cleanup();
	});

	it('keeps a multi-selection when the click lands inside it', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		ctx.selection.select(['a', 'b']);
		stack.hits = ['b'];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(ctx.selection.ids).toEqual(['a', 'b']);
		await cleanup();
	});

	it('replaces the selection when the click lands outside it', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		ctx.selection.select(['a', 'b']);
		stack.hits = ['c'];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(ctx.selection.ids).toEqual(['c']);
		await cleanup();
	});

	it('clears the selection and opens the empty canvas menu on nothing', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		ctx.selection.select(['a']);
		stack.hits = [];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(ctx.selection.ids).toEqual([]);
		expect(ctx.menus.popup?.kind).toBe('canvas-empty');
		await cleanup();
	});

	it('lists the layers under the cursor in the Select layer submenu, then removes them', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		stack.hits = ['b', 'f'];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(titles(ctx, 'context/select-layer')).toEqual(['b', 'F']);
		const entry = ctx.menus.resolve('context/canvas').find((item) => item.id === 'select-layer');
		expect(entry?.submenu).toHaveLength(2);
		stack.hits = ['b'];
		ctx.emit('canvas/contextmenu', rightClick());
		expect(titles(ctx, 'context/select-layer')).toEqual([]);
		await cleanup();
	});

	it('Select layer replaces the selection', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		await ctx.commands.run('context-menus.select-layer', { id: 'f' });
		expect(ctx.selection.ids).toEqual(['f']);
		await cleanup();
	});
});

describe('menu contents per selection', () => {
	const cases: Array<{ name: string; selected: NodeId[]; has: string[]; lacks: string[] }> = [
		{ name: 'rectangle', selected: ['a'], has: ['Duplicate', 'Delete', 'Rename'], lacks: [] },
		{ name: 'frame', selected: ['f'], has: ['Group selection', 'Bring to front'], lacks: [] },
		{ name: 'mixed', selected: ['a', 'f'], has: ['Flip horizontal'], lacks: [] }
	];
	for (const entry of cases) {
		it(`shows the selection items for a ${entry.name}`, async () => {
			const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
			ctx.selection.select(entry.selected);
			const shown = ctx.menus.resolve('context/canvas').filter((item) => item.enabled);
			for (const title of entry.has) expect(shown.map((item) => item.title)).toContain(title);
			await cleanup();
		});
	}

	it('disables selection items when nothing is selected, and the empty menu has none', async () => {
		const { ctx, cleanup } = await mountPlugin(contextMenus, { providers });
		const enabled = ctx.menus.resolve('context/canvas').filter((item) => item.enabled);
		expect(enabled.map((item) => item.title)).not.toContain('Delete');
		expect(titles(ctx, 'context/canvas-empty')).not.toContain('Delete');
		await cleanup();
	});
});
