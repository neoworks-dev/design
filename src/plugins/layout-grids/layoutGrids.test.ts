import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { LayoutGrid } from '../../lib/document';
import { drawLayoutGrids } from '../../lib/layout-grids/draw';
import { defaultGrid } from '../../lib/layout-grids/grids';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { OverlayFrame } from '../../lib/overlay/types';
import { selectionProviders } from '../../lib/selecting/fixtures/selectionFixture';
import colorPicker from '../color-picker';
import coreInspectors from '../core-inspectors';
import corePanels from '../core-panels';
import variablesCore from '../variables-core';
import layoutGrids from './index';

const storage = { getItem: (): null => null, setItem: (): void => {} };
const panels = { ...corePanels, apply: (ctx: never) => corePanels.apply(ctx, { storage }) };

function providers(): Plugin[] {
	return [...selectionProviders(), variablesCore, panels as Plugin, coreInspectors, colorPicker];
}

describePlugin('layout-grids', layoutGrids, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.overlay.registry.list().map((entry) => entry.id)).toContain('layout-grids/grids');
		expect(ctx.panels.sectionRegistry.get('design/layout-grid')).toBeDefined();
		expect(ctx.commands.has('view.toggle-layout-grids')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('shift+g');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

const COLUMNS: LayoutGrid = {
	...defaultGrid('COLUMNS'),
	count: 4,
	gutterSize: 0,
	offset: 0
};

async function mountWithGrid(grid: LayoutGrid): Promise<Context> {
	mounted = await mountPlugin(layoutGrids, { providers: providers() });
	const { ctx } = mounted;
	ctx.document.apply(ctx.document.setProps('F', { layoutGrids: [grid] }), {
		origin: 'user',
		label: 'Add grid'
	});
	return ctx;
}

function snapX(ctx: Context, x: number): number {
	const outcome = ctx.snapping.snap({ x, y: 50, width: 10, height: 10 }, { parentId: 'F' });
	return x + outcome.delta.x;
}

describe('layout grid snapping', () => {
	it('snaps objects to column edges and stops when the grids are hidden', async () => {
		const ctx = await mountWithGrid(COLUMNS);
		expect(snapX(ctx, 102)).toBe(100);
		await ctx.commands.run('view.toggle-layout-grids');
		expect(snapX(ctx, 102)).toBe(102);
		await ctx.commands.run('view.toggle-layout-grids');
		expect(snapX(ctx, 102)).toBe(100);
	});

	it('snaps to row edges and ignores grids marked invisible', async () => {
		const ctx = await mountWithGrid({ ...defaultGrid('ROWS'), count: 2, gutterSize: 0, offset: 0 });
		const outcome = ctx.snapping.snap({ x: 60, y: 203, width: 10, height: 10 }, { parentId: 'F' });
		expect(203 + outcome.delta.y).toBe(200);
		ctx.document.apply(
			ctx.document.setProps('F', { layoutGrids: [{ ...COLUMNS, visible: false }] }),
			{ origin: 'user', label: 'Hide grid' }
		);
		expect(snapX(ctx, 102)).toBe(102);
	});
});

interface Recorder {
	fills: number;
	strokes: number;
}

function recordingFrame(recorder: Recorder): OverlayFrame {
	const ctx = {
		beginPath: (): void => {},
		moveTo: (): void => {},
		lineTo: (): void => {},
		closePath: (): void => {},
		fill: (): void => void (recorder.fills += 1),
		stroke: (): void => void (recorder.strokes += 1)
	} as unknown as CanvasRenderingContext2D;
	return {
		ctx,
		camera: { x: 0, y: 0, scale: 1 },
		size: { width: 800, height: 600 },
		devicePixelRatio: 1,
		worldToScreen: (point) => point,
		worldRectToScreen: (rect) => rect
	};
}

describe('layout grid drawing', () => {
	const target = {
		id: 'F',
		matrix: [
			[1, 0, 0],
			[0, 1, 0]
		] as [[number, number, number], [number, number, number]],
		width: 400,
		height: 400
	};

	it('fills one band per column and per row', () => {
		const recorder: Recorder = { fills: 0, strokes: 0 };
		const grids = [COLUMNS, { ...defaultGrid('ROWS'), count: 3, gutterSize: 0, offset: 0 }];
		drawLayoutGrids(recordingFrame(recorder), [{ ...target, grids }]);
		expect(recorder.fills).toBe(7);
	});

	it('strokes the lines of a square grid and skips hidden grids', () => {
		const recorder: Recorder = { fills: 0, strokes: 0 };
		const grid = { ...defaultGrid('GRID'), sectionSize: 100 };
		drawLayoutGrids(recordingFrame(recorder), [
			{ ...target, grids: [grid, { ...COLUMNS, visible: false }] }
		]);
		expect(recorder.strokes).toBe(10);
		expect(recorder.fills).toBe(0);
	});
});
