import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { createNode, keyBetween, type Node, type NodeId } from '../../lib/document';
import { buildDocument, frame, page } from '../../lib/document/fixtures';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import autolayout from './index';
import { at, autolayoutProviders, paragraphsOf, rect } from './fixtures/autolayoutFixture';

function sample(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame(
					{
						id: 'af',
						name: 'AF',
						transform: at(100, 100),
						width: 300,
						height: 100,
						layoutMode: 'HORIZONTAL',
						itemSpacing: 10,
						paddingTop: 10,
						paddingRight: 10,
						paddingBottom: 10,
						paddingLeft: 10,
						layoutSizingHorizontal: 'HUG',
						layoutSizingVertical: 'HUG'
					},
					[rect('a', 50, 20, 7, 9), rect('b', 30, 40, 99, 99)]
				),
				frame({ id: 'plain', name: 'Plain', width: 200, height: 200, transform: at(500, 0) }, [
					rect('p', 10, 10, 3, 3)
				])
			],
			{ id: 'p0' }
		)
	]);
}

describePlugin('autolayout', autolayout, {
	providers: autolayoutProviders(sample()),
	contributes: ({ ctx }) => {
		expect(ctx.autolayout).toBeDefined();
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(autolayout, { providers: autolayoutProviders(sample()) });
	return mounted.ctx;
}

function geometry(ctx: Context, id: NodeId): Record<string, number> {
	const node = ctx.document.require(id);
	if (node.type === 'PAGE') throw new Error('page');
	return {
		x: node.transform[0][2],
		y: node.transform[1][2],
		width: node.width,
		height: node.height
	};
}

function tail(ctx: Context, parentId: NodeId): string {
	return keyBetween(ctx.document.childNodes(parentId).at(-1)?.index ?? null, null);
}

function apply(
	ctx: Context,
	changes: ReturnType<Context['document']['setProps']>
): ReturnType<Context['document']['apply']> {
	return ctx.document.apply(changes, { origin: 'user', label: 'Edit' });
}

describe('reflow in the triggering transaction', () => {
	it('lays out the children and sizes the hugging frame when an edit disturbs it', async () => {
		const ctx = await open();
		const transaction = apply(ctx, ctx.document.setProps('af', { itemSpacing: 20 }));
		expect(geometry(ctx, 'a')).toEqual({ x: 10, y: 10, width: 50, height: 20 });
		expect(geometry(ctx, 'b')).toEqual({ x: 80, y: 10, width: 30, height: 40 });
		expect(geometry(ctx, 'af')).toMatchObject({ x: 100, y: 100, width: 120, height: 60 });
		const reflowed = transaction.changes.filter(
			(change) => change.t === 'set' && change.id !== 'af'
		);
		expect(reflowed.length).toBeGreaterThan(0);
	});

	it('is one undo step and undo restores the stored geometry exactly', async () => {
		const ctx = await open();
		const before = ['af', 'a', 'b'].map((id) => geometry(ctx, id));
		apply(ctx, ctx.document.setProps('af', { itemSpacing: 20 }));
		expect(ctx.history.entries).toHaveLength(1);
		expect(ctx.history.undo()).toBe(true);
		expect(['af', 'a', 'b'].map((id) => geometry(ctx, id))).toEqual(before);
		expect(ctx.history.redo()).toBe(true);
		expect(geometry(ctx, 'b')).toMatchObject({ x: 80 });
	});

	it('is idempotent', async () => {
		const ctx = await open();
		apply(ctx, ctx.document.setProps('af', { itemSpacing: 20 }));
		expect(ctx.autolayout.reflowTree('af')).toEqual([]);
		const again = apply(ctx, ctx.document.setProps('af', { itemSpacing: 20 }));
		expect(again.changes).toEqual([]);
	});

	it('reflows when a child is added, removed or reordered', async () => {
		const ctx = await open();
		const extra = createNode('RECTANGLE', {
			id: 'c',
			name: 'c',
			parentId: 'af',
			index: tail(ctx, 'af'),
			width: 20,
			height: 70
		});
		apply(ctx, ctx.document.insertNode(extra));
		expect(geometry(ctx, 'c')).toMatchObject({ x: 110, y: 10 });
		expect(geometry(ctx, 'af')).toMatchObject({ width: 140, height: 90 });
		apply(ctx, ctx.document.moveNode('c', 'af', 0));
		expect(geometry(ctx, 'c')).toMatchObject({ x: 10 });
		expect(geometry(ctx, 'a')).toMatchObject({ x: 40 });
		apply(ctx, ctx.document.removeNode('c'));
		expect(geometry(ctx, 'af')).toMatchObject({ width: 110, height: 60 });
	});

	it('reflows a nested auto layout chain from a leaf change', async () => {
		const ctx = await open();
		const inner = createNode('FRAME', {
			id: 'inner',
			name: 'inner',
			parentId: 'af',
			index: tail(ctx, 'af'),
			layoutMode: 'VERTICAL',
			layoutSizingHorizontal: 'HUG',
			layoutSizingVertical: 'HUG',
			itemSpacing: 4
		});
		const leafA = createNode('RECTANGLE', {
			id: 'ia',
			name: 'ia',
			parentId: 'inner',
			index: 'a',
			width: 20,
			height: 10
		});
		const leafB = createNode('RECTANGLE', {
			id: 'ib',
			name: 'ib',
			parentId: 'inner',
			index: 'b',
			width: 25,
			height: 10
		});
		apply(ctx, ctx.document.insertNodes([inner, leafA, leafB] as Node[]));
		expect(geometry(ctx, 'inner')).toMatchObject({ x: 110, y: 10, width: 25, height: 24 });
		apply(ctx, ctx.document.setProps('ib', { height: 30 }));
		expect(geometry(ctx, 'inner')).toMatchObject({ width: 25, height: 44 });
		expect(geometry(ctx, 'af')).toMatchObject({ height: 64 });
	});

	it('leaves frames without auto layout alone', async () => {
		const ctx = await open();
		apply(ctx, ctx.document.setProps('p', { width: 40 }));
		expect(geometry(ctx, 'p')).toEqual({ x: 3, y: 3, width: 40, height: 10 });
	});

	it('snaps a flow child that was moved by hand back into place', async () => {
		const ctx = await open();
		apply(ctx, ctx.document.setProps('af', { itemSpacing: 20 }));
		apply(ctx, ctx.document.setProps('a', { transform: at(55, 55) }));
		expect(geometry(ctx, 'a')).toMatchObject({ x: 10, y: 10 });
	});
});

describe('text children', () => {
	it('hugs auto-width text and wraps fill-width text', async () => {
		const ctx = await open();
		const label = createNode('TEXT', {
			id: 'label',
			name: 'label',
			parentId: 'af',
			index: tail(ctx, 'af'),
			paragraphs: paragraphsOf('hello'),
			textAutoResize: 'WIDTH_AND_HEIGHT'
		});
		apply(ctx, ctx.document.insertNode(label));
		expect(geometry(ctx, 'label')).toMatchObject({ x: 110, y: 10, width: 50, height: 20 });
		expect(geometry(ctx, 'af')).toMatchObject({ width: 170 });

		apply(
			ctx,
			ctx.document.setProps('af', {
				layoutMode: 'VERTICAL',
				layoutSizingHorizontal: 'FIXED',
				width: 100
			})
		);
		apply(ctx, ctx.document.setProps('label', { paragraphs: paragraphsOf('a'.repeat(30)) }));
		apply(ctx, ctx.document.setProps('label', { layoutSizingHorizontal: 'FILL' }));
		const stored = ctx.document.require('label');
		expect(stored).toMatchObject({ textAutoResize: 'HEIGHT', width: 80, height: 80 });
		expect(geometry(ctx, 'af').height).toBe(180);
	});
});

function rowDocument(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'row', name: 'Row', transform: at(50, 50), width: 175, height: 80 }, [
					rect('r1', 40, 30, 10, 20),
					rect('r2', 40, 30, 60, 20),
					rect('r3', 40, 30, 115, 20)
				]),
				rect('loose1', 30, 30, 400, 10),
				rect('loose2', 30, 30, 450, 20)
			],
			{ id: 'p0' }
		)
	]);
}

async function openRow(): Promise<Context> {
	mounted = await mountPlugin(autolayout, { providers: autolayoutProviders(rowDocument()) });
	return mounted.ctx;
}

function snapshotNodes(ctx: Context): Record<string, Node> {
	return structuredClone(ctx.document.snapshot.nodes);
}

describe('add and remove auto layout', () => {
	it('infers direction, gap and padding for a frame and keeps its children in place', async () => {
		const ctx = await openRow();
		ctx.selection.select(['row']);
		await ctx.commands.run('autolayout.add');
		expect(ctx.document.require('row')).toMatchObject({
			layoutMode: 'HORIZONTAL',
			itemSpacing: 13,
			paddingLeft: 10,
			paddingTop: 20,
			paddingRight: 20,
			paddingBottom: 30,
			layoutSizingHorizontal: 'HUG',
			layoutSizingVertical: 'HUG'
		});
		expect(geometry(ctx, 'row')).toMatchObject({ x: 50, y: 50, width: 176, height: 80 });
		expect(geometry(ctx, 'r1')).toMatchObject({ x: 10, y: 20 });
		expect(geometry(ctx, 'r2')).toMatchObject({ x: 63, y: 20 });
		expect(ctx.selection.ids).toEqual(['row']);
	});

	it('adding and undoing is exact', async () => {
		const ctx = await openRow();
		const before = snapshotNodes(ctx);
		ctx.selection.select(['row', 'loose1', 'loose2']);
		await ctx.commands.run('autolayout.add');
		expect(ctx.history.entries).toHaveLength(1);
		expect(ctx.history.undo()).toBe(true);
		expect(snapshotNodes(ctx)).toEqual(before);
	});

	it('wraps non-frame selections in an auto layout frame at the same position', async () => {
		const ctx = await openRow();
		ctx.selection.select(['loose1', 'loose2']);
		await ctx.commands.run('autolayout.add');
		const [wrapperId] = ctx.selection.ids;
		const wrapper = ctx.document.require(wrapperId);
		expect(wrapper).toMatchObject({ type: 'FRAME', layoutMode: 'HORIZONTAL', parentId: 'p0' });
		expect(geometry(ctx, wrapperId)).toMatchObject({ x: 400, y: 10, width: 80, height: 30 });
		expect(ctx.document.require('loose1').parentId).toBe(wrapperId);
		expect(geometry(ctx, 'loose1')).toMatchObject({ x: 0, y: 0 });
		expect(geometry(ctx, 'loose2')).toMatchObject({ x: 50, y: 0 });
	});

	it('puts children in stacking order by position', async () => {
		const ctx = await openRow();
		const reversed = ctx.document.moveNode('r3', 'row', 0);
		ctx.document.apply(reversed, { origin: 'user', label: 'Reorder' });
		ctx.selection.select(['row']);
		await ctx.commands.run('autolayout.add');
		expect(ctx.document.children('row')).toEqual(['r1', 'r2', 'r3']);
	});

	it('removes auto layout and leaves the children where the layout put them', async () => {
		const ctx = await openRow();
		ctx.selection.select(['row']);
		await ctx.commands.run('autolayout.add');
		const laidOut = ['r1', 'r2', 'r3'].map((id) => geometry(ctx, id));
		ctx.document.apply(ctx.document.setProps('r2', { layoutSizingHorizontal: 'FILL' }), {
			origin: 'user',
			label: 'Fill'
		});
		const filled = geometry(ctx, 'r2');
		await ctx.commands.run('autolayout.remove');
		expect(ctx.document.require('row')).toMatchObject({
			layoutMode: 'NONE',
			layoutSizingHorizontal: 'FIXED'
		});
		expect(ctx.document.require('r2')).toMatchObject({ layoutSizingHorizontal: 'FIXED' });
		expect(geometry(ctx, 'r2')).toEqual(filled);
		expect(geometry(ctx, 'r1')).toEqual(laidOut[0]);
		ctx.document.apply(ctx.document.setProps('r1', { width: 5 }), { origin: 'user', label: 'x' });
		expect(geometry(ctx, 'r2')).toEqual(filled);
	});

	it('offers remove only where the selection has auto layout', async () => {
		const ctx = await openRow();
		ctx.selection.select(['row']);
		expect(ctx.contextKeys.get('selectionHasAutoLayout')).toBe(false);
		await ctx.commands.run('autolayout.add');
		expect(ctx.contextKeys.get('selectionHasAutoLayout')).toBe(true);
	});
});
