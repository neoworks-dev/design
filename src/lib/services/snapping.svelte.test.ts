import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import snappingPlugin from '../../plugins/snapping';
import spatialPlugin from '../../plugins/spatial';
import { editingProviders } from '../editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../kernel/testing';
import type { Rect } from '../document';

/** Stands in for the viewport plugin: a fixed zoom and visible rectangle. */
function fakeViewport(zoom: number, visible: Rect): Plugin {
	return {
		name: 'viewport',
		inject: [],
		apply: (ctx: Context) => void ctx.provide('viewport', { zoom, visibleRect: () => visible })
	} as Plugin;
}

const WHOLE_PAGE = { x: -1000, y: -1000, width: 4000, height: 4000 };

// Page p: frame f at 100,100 (400x400) with boxes a (0,0 10x10 -> page 100,100), b (20,20 ->
// 120,120), c (40,40 -> 140,140); loose at 600,600.
function providers(zoom = 1, visible: Rect = WHOLE_PAGE): Plugin[] {
	return [...editingProviders(), spatialPlugin, fakeViewport(zoom, visible)] as Plugin[];
}

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

describePlugin('snapping', snappingPlugin, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('snapping.toggle')).toBe(true);
		expect(ctx.menus.has('app/view')).toBe(true);
		expect(ctx.snapping.enabled).toBe(true);
		expect(ctx.snapping.guides).toEqual([]);
	}
});

describe('snapping service', () => {
	it('snaps to siblings in the same parent, the parent box and top-level frames', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		// Dragging a sibling of a/b/c (inside f): candidates are a, b, c and f's box.
		const candidates = snapping.candidateRects(rect(300, 300, 10, 10), {
			parentId: 'f',
			ignoreIds: []
		});
		expect(candidates).toHaveLength(4);
		const result = snapping.snap(rect(302, 300, 16, 10), { parentId: 'f' });
		expect(result.delta).toEqual({ x: -2, y: 0 });
		const xGuides = snapping.guides.filter((guide) => guide.axis === 'x');
		expect(xGuides.map((guide) => guide.position)).toEqual([300]);
		await mounted.cleanup();
	});

	it('ignores the moving nodes themselves and hidden nodes', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { ctx } = mounted;
		const without = ctx.snapping.snap(rect(302, 300, 16, 10), {
			parentId: 'f',
			ignoreIds: ['a', 'f']
		});
		expect(without.delta.x).not.toBe(-2);
		ctx.document.apply(ctx.document.setProps('a', { visible: false }), {
			origin: 'user',
			label: 'Hide'
		});
		const hidden = ctx.snapping.candidateRects(rect(300, 300, 10, 10), { parentId: 'f' });
		expect(hidden).toHaveLength(3);
		await mounted.cleanup();
	});

	it('uses a threshold of 5 screen pixels divided by the zoom', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers(4) });
		const { snapping } = mounted.ctx;
		expect(snapping.threshold).toBeCloseTo(1.25);
		expect(snapping.snap(rect(101, 300, 10, 10), { parentId: 'f' }).delta.x).toBe(-1);
		expect(snapping.snap(rect(102, 300, 10, 10), { parentId: 'f' }).delta.x).toBe(0);
		await mounted.cleanup();
		const zoomedOut = await mountPlugin(snappingPlugin, { providers: providers(0.5) });
		expect(zoomedOut.ctx.snapping.threshold).toBe(10);
		await zoomedOut.cleanup();
	});

	it('limits candidates to the viewport', async () => {
		const mounted = await mountPlugin(snappingPlugin, {
			providers: providers(1, rect(510, 510, 300, 300))
		});
		const { snapping } = mounted.ctx;
		const candidates = snapping.candidateRects(rect(520, 520, 10, 10), { ignoreIds: [] });
		// Only `loose` is visible among the top-level objects; frame f is out of view.
		expect(candidates).toEqual([rect(600, 600, 10, 10)]);
		await mounted.cleanup();
	});

	it('clears guides on release, when bypassed (Ctrl) and when disabled', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		snapping.snap(rect(302, 300, 16, 10), { parentId: 'f' });
		expect(snapping.guides).not.toHaveLength(0);
		snapping.release();
		expect(snapping.guides).toEqual([]);
		snapping.snap(rect(302, 300, 16, 10), { parentId: 'f' });
		const bypassed = snapping.snap(rect(302, 300, 16, 10), { parentId: 'f', bypass: true });
		expect(bypassed).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
		expect(snapping.guides).toEqual([]);
		snapping.setEnabled(false);
		expect(snapping.snap(rect(302, 300, 16, 10), { parentId: 'f' }).delta).toEqual({ x: 0, y: 0 });
		await mounted.cleanup();
	});

	it('the toggle command flips the global switch; config can start it off', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		await mounted.ctx.commands.run('snapping.toggle');
		expect(mounted.ctx.snapping.enabled).toBe(false);
		await mounted.cleanup();
		const off = await mountPlugin(
			{ ...snappingPlugin, apply: (ctx: Context) => snappingPlugin.apply(ctx, { enabled: false }) },
			{ providers: providers() }
		);
		expect(off.ctx.snapping.enabled).toBe(false);
		await off.cleanup();
	});
});
