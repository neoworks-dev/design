import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import snappingPlugin from '../../plugins/snapping';
import spatialPlugin from '../../plugins/spatial';
import { editingProviders } from '../editing/fixtures/editingFixture';
import type { OverlayContribution } from '../overlay/types';
import { OverlayRegistry } from './overlay';
import { describePlugin, mountPlugin } from '../kernel/testing';
import type { DesignDocument, Rect } from '../document';
import { buildDocument, page, rectangle } from '../document/fixtures';

/** Stands in for the viewport plugin: a fixed zoom and visible rectangle. */
function fakeViewport(zoom: number, visible: Rect): Plugin {
	return {
		name: 'viewport',
		inject: [],
		apply: (ctx: Context) =>
			void ctx.provide('viewport', {
				zoom,
				visibleRect: () => visible,
				worldToScreen: (point: { x: number; y: number }) => ({
					x: point.x * zoom,
					y: point.y * zoom
				})
			})
	} as Plugin;
}

/** Stands in for the overlay plugin: records contributions in a registry. */
function fakeOverlay(): Plugin {
	const registry = new OverlayRegistry();
	return {
		name: 'overlay',
		inject: [],
		apply: (ctx: Context) =>
			void ctx.provide('overlay', {
				registry,
				register: (contribution: OverlayContribution) => registry.register(contribution)
			})
	} as Plugin;
}

const WHOLE_PAGE = { x: -1000, y: -1000, width: 4000, height: 4000 };

// Page p: frame f at 100,100 (400x400) with boxes a (0,0 10x10 -> page 100,100), b (20,20 ->
// 120,120), c (40,40 -> 140,140); loose at 600,600.
function providers(zoom = 1, visible: Rect = WHOLE_PAGE, document?: DesignDocument): Plugin[] {
	const base = document === undefined ? editingProviders() : editingProviders(document);
	return [...base, spatialPlugin, fakeViewport(zoom, visible), fakeOverlay()] as Plugin[];
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
		expect(ctx.overlay.registry.has('snapping/guides')).toBe(true);
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
		expect(bypassed).toEqual({ delta: { x: 0, y: 0 }, guides: [], gaps: [] });
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
		const off = await mountPlugin(snappingPlugin, {
			providers: providers(),
			config: { enabled: false }
		});
		expect(off.ctx.snapping.enabled).toBe(false);
		await off.cleanup();
	});
});

function box(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number
): ReturnType<typeof rectangle> {
	return rectangle({
		id,
		name: id,
		transform: [
			[1, 0, x],
			[0, 1, y]
		],
		width,
		height
	});
}

describe('pixel grid snapping', () => {
	it('is off by default and registers a command in the View menu', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		expect(mounted.ctx.snapping.pixelSnapEnabled).toBe(false);
		expect(mounted.ctx.commands.has('snapping.toggle-pixel')).toBe(true);
		const chords = mounted.ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain("ctrl+shift+'");
		await mounted.cleanup();
	});

	it('rounds a move to whole pixels, also with object snapping off', async () => {
		const mounted = await mountPlugin(snappingPlugin, {
			providers: providers(),
			config: { enabled: false }
		});
		const { snapping } = mounted.ctx;
		expect(snapping.snap(rect(300.4, 300.6, 10.5, 10.5)).delta).toEqual({ x: 0, y: 0 });
		snapping.setPixelSnap(true);
		const { delta } = snapping.snap(rect(300.4, 300.6, 10.5, 10.5));
		expect(300.4 + delta.x).toBe(300);
		expect(300.6 + delta.y).toBe(301);
		await mounted.cleanup();
	});

	it('rounds only the dragged edge of a resize, leaving the size whole', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		snapping.setPixelSnap(true);
		const { delta } = snapping.snap(rect(300, 300, 50.4, 20), {
			lines: { x: ['max'] },
			axes: 'x'
		});
		expect(300 + 50.4 + delta.x).toBeCloseTo(350, 9);
		expect(delta.y).toBe(0);
		await mounted.cleanup();
	});

	it('lets an object snap win on its axis and rounds the other axis', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		snapping.setPixelSnap(true);
		// near the frame's left edge (x = 100): the object snap pulls x to 100, y rounds
		const { delta } = snapping.snap(rect(101.3, 700.4, 10, 10), { ignoreIds: ['loose'] });
		expect(101.3 + delta.x).toBeCloseTo(100, 9);
		expect(700.4 + delta.y).toBe(700);
		await mounted.cleanup();
	});

	it('is skipped for a bypassed (Ctrl) call', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		snapping.setPixelSnap(true);
		expect(snapping.snap(rect(300.4, 300.6, 10, 10), { bypass: true }).delta).toEqual({
			x: 0,
			y: 0
		});
		await mounted.cleanup();
	});

	it('rounds creation points and answers the nudge waterfall while on', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { ctx } = mounted;
		expect(ctx.waterfall('nudge/pixel-snap', false, () => false)).toBe(false);
		ctx.snapping.setPixelSnap(true);
		expect(ctx.waterfall('nudge/pixel-snap', false, () => false)).toBe(true);
		const point = ctx.waterfall('tools/snap-point', { x: 700.4, y: 700.6 }, () => ({
			x: 700.4,
			y: 700.6
		}));
		expect(point).toEqual({ x: 700, y: 701 });
		await mounted.cleanup();
	});

	it('the toggle command flips the switch by updating the plugin config', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		await mounted.ctx.commands.run('snapping.toggle-pixel');
		expect(mounted.ctx.snapping.pixelSnapEnabled).toBe(true);
		expect(mounted.fiber.config.pixelSnap).toBe(true);
		await mounted.ctx.commands.run('snapping.toggle-pixel');
		expect(mounted.ctx.snapping.pixelSnapEnabled).toBe(false);
		expect(mounted.fiber.config.pixelSnap).toBe(false);
		await mounted.cleanup();
	});

	it('starts with pixel snap on when the config says so, and no storage is involved', async () => {
		const mounted = await mountPlugin(snappingPlugin, {
			providers: providers(),
			config: { pixelSnap: true }
		});
		expect(mounted.ctx.snapping.pixelSnapEnabled).toBe(true);
		expect(globalThis.localStorage.getItem('design.snapping.pixel')).toBeNull();
		await mounted.cleanup();
	});
});

describe('equal spacing through the service', () => {
	const row = buildDocument([
		page('Row', [box('l', 0, 0, 50, 40), box('r', 150, 0, 50, 40), box('m', 400, 400, 20, 30)], {
			id: 'p'
		})
	]);

	it('snaps between two neighbours and exposes the brackets until release', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers(1, WHOLE_PAGE, row) });
		const { snapping } = mounted.ctx;
		const outcome = snapping.snap(rect(87, 5, 20, 30), { ignoreIds: ['m'] });
		expect(outcome.delta.x).toBe(3);
		expect(outcome.gaps.map((gap) => gap.distance)).toEqual([40, 40]);
		expect(snapping.gaps).toHaveLength(2);
		snapping.release();
		expect(snapping.gaps).toEqual([]);
		await mounted.cleanup();
	});

	it('is not used for resizes, and does not override a closer object snap', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers(1, WHOLE_PAGE, row) });
		const { snapping } = mounted.ctx;
		const resize = snapping.snap(rect(87, 5, 20, 30), {
			ignoreIds: ['m'],
			lines: { x: ['max'], y: [] }
		});
		expect(resize.gaps).toEqual([]);
		// Left edge 49 is 1 away from `l`'s right edge (object snap) and the spacing shift is larger.
		const closer = snapping.snap(rect(49, 5, 20, 30), { ignoreIds: ['m'] });
		expect(closer.delta.x).toBe(1);
		expect(closer.gaps).toEqual([]);
		await mounted.cleanup();
	});
});

describe('distance measurement through the service', () => {
	it('measures the hovered node and the selection container', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		const measurement = snapping.measure({ selectionIds: ['a'], targetId: 'loose' });
		expect(measurement.target.map((line) => [line.axis, line.distance])).toEqual([
			['x', 490],
			['y', 490]
		]);
		// `a` sits in the top-left corner of frame f (400 x 400): only the far insets are non-zero.
		expect(measurement.container.map((line) => `${line.axis}${line.distance}`).sort()).toEqual([
			'x390',
			'y390'
		]);
		expect(snapping.measurement).toBe(measurement);
		snapping.clearMeasurement();
		expect(snapping.measurement).toBeNull();
		await mounted.cleanup();
	});

	it('Ctrl+Alt restricts to the selection container; hovering the selection itself measures nothing', async () => {
		const mounted = await mountPlugin(snappingPlugin, { providers: providers() });
		const { snapping } = mounted.ctx;
		expect(
			snapping.measure({ selectionIds: ['a'], targetId: 'loose', groupScope: true }).target
		).toEqual([]);
		expect(
			snapping.measure({ selectionIds: ['a'], targetId: 'c', groupScope: true }).target
		).not.toEqual([]);
		expect(snapping.measure({ selectionIds: ['a'], targetId: 'a' }).target).toEqual([]);
		await mounted.cleanup();
	});

	it('projects to screen space with labels that stay page distances at 50% and 400% zoom', async () => {
		for (const zoom of [0.5, 4]) {
			const mounted = await mountPlugin(snappingPlugin, { providers: providers(zoom) });
			const { snapping } = mounted.ctx;
			const { target } = snapping.measure({ selectionIds: ['a'], targetId: 'loose' });
			const [horizontal] = snapping.projectMeasurement(target);
			expect(horizontal.label).toBe('490');
			expect(horizontal.to.x - horizontal.from.x).toBeCloseTo(490 * zoom, 9);
			await mounted.cleanup();
		}
	});
});
