import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import type { OverlayContribution, OverlayFrame } from '../../lib/overlay/types';
import { OverlayRegistry } from '../../lib/services/overlay';
import { drawPixelGrid, isPixelGridVisible } from '../../lib/viewport/pixelGrid';
import pixelGrid from './index';

class FakeRenderer {
	pixelPreview = false;
	setPixelPreview(enabled: boolean): void {
		this.pixelPreview = enabled;
	}
}

function fakes(zoom: number, renderer: FakeRenderer): Plugin[] {
	const registry = new OverlayRegistry();
	return [
		...editingProviders(),
		{
			name: 'fake-pixel-grid-dependencies',
			inject: [],
			apply(ctx: Context): void {
				ctx.provide('viewport', { zoom, camera: { x: 0, y: 0, scale: zoom } });
				ctx.provide('renderer', renderer);
				ctx.provide('overlay', {
					registry,
					register: (contribution: OverlayContribution) => registry.register(contribution)
				});
			}
		} as Plugin
	];
}

describePlugin('pixel-grid', pixelGrid, {
	providers: fakes(8, new FakeRenderer()),
	contributes: ({ ctx }) => {
		expect(ctx.overlay.registry.list().map((entry) => entry.id)).toContain('pixel-grid/grid');
		expect(ctx.commands.get('view.toggle-pixel-grid')).toBeDefined();
		expect(ctx.commands.get('view.toggle-pixel-preview')).toBeDefined();
	}
});

describe('pixel grid service', () => {
	it('shows the grid only from 800% up, and only while it is switched on', async () => {
		const low = await mountPlugin(pixelGrid, { providers: fakes(7.99, new FakeRenderer()) });
		expect(low.ctx.pixelGrid.gridVisible).toBe(false);
		await low.cleanup();
		const high = await mountPlugin(pixelGrid, { providers: fakes(8, new FakeRenderer()) });
		expect(high.ctx.pixelGrid.gridVisible).toBe(true);
		high.ctx.pixelGrid.toggleGrid();
		expect(high.ctx.pixelGrid.gridVisible).toBe(false);
		await high.cleanup();
	});

	it('toggles pixel preview on the renderer and switches it off when the plugin unloads', async () => {
		const renderer = new FakeRenderer();
		const mounted = await mountPlugin(pixelGrid, { providers: fakes(2, renderer) });
		mounted.ctx.pixelGrid.togglePreview();
		expect(renderer.pixelPreview).toBe(true);
		expect(mounted.ctx.pixelGrid.previewEnabled).toBe(true);
		mounted.ctx.pixelGrid.togglePreview();
		expect(renderer.pixelPreview).toBe(false);
		mounted.ctx.pixelGrid.togglePreview();
		await mounted.cleanup();
		expect(renderer.pixelPreview).toBe(false);
	});

	it('runs the toggles from their commands', async () => {
		const renderer = new FakeRenderer();
		const mounted = await mountPlugin(pixelGrid, { providers: fakes(8, renderer) });
		await mounted.ctx.commands.get('view.toggle-pixel-preview')?.run();
		expect(renderer.pixelPreview).toBe(true);
		await mounted.ctx.commands.get('view.toggle-pixel-grid')?.run();
		expect(mounted.ctx.pixelGrid.gridEnabled).toBe(false);
		await mounted.cleanup();
	});
});

interface Recorded {
	columns: number[];
	rows: number[];
	lineWidth: number;
	strokes: number;
}

function recordGrid(
	camera: { x: number; y: number; scale: number },
	devicePixelRatio: number
): Recorded {
	const recorded: Recorded = { columns: [], rows: [], lineWidth: 0, strokes: 0 };
	let lastMove = { x: 0, y: 0 };
	const ctx = {
		save: () => {},
		restore: () => {},
		beginPath: () => {},
		stroke: () => void (recorded.strokes += 1),
		moveTo: (x: number, y: number) => void (lastMove = { x, y }),
		lineTo: (x: number, y: number) => {
			if (x === lastMove.x) recorded.columns.push(x);
			else if (y === lastMove.y) recorded.rows.push(y);
		},
		set lineWidth(value: number) {
			recorded.lineWidth = value;
		},
		set strokeStyle(_value: string) {}
	} as unknown as CanvasRenderingContext2D;
	const frame: OverlayFrame = {
		ctx,
		camera,
		size: { width: 100, height: 60 },
		devicePixelRatio,
		worldToScreen: (point) => point,
		worldRectToScreen: (rect) => rect
	};
	drawPixelGrid(frame);
	return recorded;
}

describe('drawPixelGrid', () => {
	it('draws nothing below 800%', () => {
		expect(isPixelGridVisible(7.99)).toBe(false);
		expect(recordGrid({ x: 0, y: 0, scale: 7.99 }, 1).strokes).toBe(0);
	});

	it('puts a line on every whole world coordinate, on device pixel boundaries', () => {
		const grid = recordGrid({ x: -4, y: 3, scale: 8 }, 1);
		// world x 1 (screen 4), x 2 (12) ... x 13 (100): world column k is at screen 8k - 4
		expect(grid.columns[0]).toBe(4.5);
		expect(grid.columns[1]).toBe(12.5);
		expect(grid.columns).toHaveLength(13);
		// world row 0 is at screen 3
		expect(grid.rows[0]).toBe(3.5);
		expect(grid.lineWidth).toBe(1);
	});

	it('uses device pixels on a high density screen', () => {
		const grid = recordGrid({ x: 0.3, y: 0, scale: 8 }, 2);
		expect(grid.lineWidth).toBe(0.5);
		for (const column of grid.columns) expect((column * 2 - 0.5) % 1).toBe(0);
	});
});
