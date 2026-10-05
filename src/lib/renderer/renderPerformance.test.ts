// Culling, picture caching and the frame budget (#45). Timings come from CanvasKit's CPU raster
// surface in Node: far slower than a GPU, so the budgets below are for this harness, with headroom
// so CI noise does not flake. The numbers are printed on every run; see docs/design/render-performance.md.

import { beforeAll, describe, expect, it } from 'vitest';
import { SceneIndex } from '../document';
import { BENCHMARK_PAGE_ID, benchmarkDocument, NODES_PER_FRAME } from './benchmarkScene';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { CanvasKitBackend } from './canvaskitBackend';
import { SkiaTracker } from './ownership';
import { StoreSceneSource } from './storeSceneSource';
import { RenderSurface } from './surface';
import type { FrameResult, ViewTransform } from './types';

const WIDTH = 1440;
const HEIGHT = 900;

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

interface Harness {
	source: StoreSceneSource;
	index: SceneIndex;
	surface: RenderSurface;
	backend: CanvasKitBackend;
	tracker: SkiaTracker;
	render(view: ViewTransform, options?: { culling?: boolean }): FrameResult;
}

function harness(frameCount: number): Harness {
	const source = new StoreSceneSource(benchmarkDocument(frameCount), { pageId: BENCHMARK_PAGE_ID });
	const index = new SceneIndex(source.store);
	const tracker = new SkiaTracker();
	const surface = RenderSurface.offscreen(canvasKit, tracker, WIDTH, HEIGHT);
	const backend = new CanvasKitBackend(canvasKit, tracker, surface);
	const culling = {
		visibleNodes: (pageId: string, rect: Parameters<SceneIndex['visible']>[1]) =>
			index.visible(pageId, rect)
	};
	return {
		source,
		index,
		surface,
		backend,
		tracker,
		render: (view, options = {}) =>
			backend.render({
				source,
				view,
				size: { width: WIDTH, height: HEIGHT },
				devicePixelRatio: 1,
				culling: options.culling === false ? undefined : culling
			})
	};
}

function timed(action: () => void): number {
	const started = performance.now();
	action();
	return performance.now() - started;
}

function median(samples: number[]): number {
	const sorted = [...samples].sort((first, second) => first - second);
	return sorted[Math.floor(sorted.length / 2)];
}

function samples(count: number, action: (round: number) => void): number {
	const durations: number[] = [];
	for (let round = 0; round < count; round += 1) durations.push(timed(() => action(round)));
	return median(durations);
}

function pixels(target: Harness): Uint8Array {
	return target.surface.readPixels({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
}

// 5 x 5 frames span 2,400 x 2,400 world units; at 0.35 the 1440 x 900 view shows all of them.
const OVERVIEW: ViewTransform = { x: 0, y: 0, scale: 0.35 };

describe('culling', () => {
	it('draws only what the view can show, with the same pixels as drawing everything', () => {
		const culled = harness(25);
		const everything = harness(25);
		const zoomed: ViewTransform = { x: -200, y: -100, scale: 1 };
		const withCulling = culled.render(zoomed);
		const withoutCulling = everything.render(zoomed, { culling: false });
		expect(withCulling.drawnNodes).toBeLessThan(withoutCulling.drawnNodes / 2);
		expect(Buffer.compare(Buffer.from(pixels(culled)), Buffer.from(pixels(everything)))).toBe(0);
	});

	it('still draws a visible child whose non-clipping parent is off screen', () => {
		const target = harness(1);
		target.source.store.getNode('bench-frame-0');
		target.source.apply([
			{
				t: 'set',
				id: 'bench-frame-0',
				set: { clipsContent: false },
				prev: { clipsContent: true }
			},
			{
				t: 'set',
				id: 'bench-0-0-0',
				set: {
					transform: [
						[1, 0, 900],
						[0, 1, 10]
					]
				},
				prev: {
					transform: [
						[1, 0, 2],
						[0, 1, 2]
					]
				}
			}
		]);
		// the frame is 400 wide: the rectangle at x = 900 lies outside it, the view at x >= 800 only sees the rectangle
		const result = target.render({ x: -800, y: 0, scale: 1 });
		expect(result.drawnNodes).toBeGreaterThanOrEqual(1);
	});
});

describe('picture cache', () => {
	it('records every big container once and replays them on pan and zoom', () => {
		const target = harness(25);
		const first = target.render(OVERVIEW);
		expect(first.picturesRecorded).toBe(25);
		const panned = target.render({ x: -100, y: -50, scale: 0.35 });
		const zoomed = target.render({ x: -100, y: -50, scale: 0.8 });
		expect(panned.picturesRecorded).toBe(0);
		expect(zoomed.picturesRecorded).toBe(0);
		expect(target.backend.pictureCache.recordedCount).toBe(25);
	});

	it('re-records only the container an edit touched', () => {
		const target = harness(25);
		target.render(OVERVIEW);
		target.source.apply([
			{
				t: 'set',
				id: 'bench-7-3-3',
				set: { opacity: 0.5 },
				prev: { opacity: 1 }
			}
		]);
		target.backend.invalidate({
			kind: 'changes',
			changes: [{ t: 'set', id: 'bench-7-3-3', set: { opacity: 0.5 }, prev: { opacity: 1 } }]
		});
		const afterEdit = target.render(OVERVIEW);
		expect(afterEdit.picturesRecorded).toBe(1);
		const afterPan = target.render({ x: -30, y: -30, scale: 0.35 });
		expect(afterPan.picturesRecorded).toBe(0);
	});

	it('looks the same as drawing the containers directly', () => {
		const cached = harness(4);
		const direct = harness(4);
		const view: ViewTransform = { x: 20, y: 30, scale: 0.9 };
		cached.render(view);
		cached.render(view);
		direct.backend.pictureCache.clear();
		direct.render(view, { culling: false });
		const first = Buffer.from(pixels(cached));
		const second = Buffer.from(pixels(direct));
		let different = 0;
		for (let index = 0; index < first.length; index += 1) {
			if (Math.abs(first[index] - second[index]) > 2) different += 1;
		}
		expect(different).toBe(0);
	});

	it('leaves no Skia objects behind once disposed', () => {
		const target = harness(4);
		target.render(OVERVIEW);
		target.backend.dispose();
		expect(target.tracker.liveCount).toBe(0);
	});
});

describe('frame budget', () => {
	// Budgets for this CPU raster harness, several times the numbers measured when written.
	const COLD_FRAME_BUDGET_MS = 500;
	const CACHED_FRAME_BUDGET_MS = 50;
	const CULLED_100K_FRAME_BUDGET_MS = 100;

	it('draws 10k visible nodes: cold, then replayed from pictures while panning', () => {
		const target = harness(25);
		const cold = timed(() => target.render(OVERVIEW));
		const nodes = 25 * (NODES_PER_FRAME + 1);
		const panning = samples(10, (round) =>
			target.render({ x: -round * 9, y: -round * 5, scale: 0.35 })
		);
		const direct = harness(25);
		direct.backend.pictureCache.clear();
		const uncached = samples(3, () => {
			direct.backend.pictureCache.clear();
			direct.render(OVERVIEW);
		});
		process.stdout.write(
			`10k visible (${nodes} nodes): cold ${cold.toFixed(0)} ms, panning from pictures ${panning.toFixed(1)} ms (median), no pictures ${uncached.toFixed(0)} ms (median)\n`
		);
		expect(cold).toBeLessThan(COLD_FRAME_BUDGET_MS);
		expect(panning).toBeLessThan(CACHED_FRAME_BUDGET_MS);
		expect(uncached).toBeLessThan(COLD_FRAME_BUDGET_MS);
	});

	it('culls a 100k node page down to what the view shows', () => {
		const target = harness(250);
		const nodes = 250 * (NODES_PER_FRAME + 1);
		const zoomedIn: ViewTransform = { x: -3000, y: -3000, scale: 1 };
		target.render(zoomedIn);
		const frame = samples(5, (round) =>
			target.render({ x: -3000 - round * 7, y: -3000, scale: 1 })
		);
		process.stdout.write(
			`100k page (${nodes} nodes) at 100%: ${frame.toFixed(1)} ms (median) per frame\n`
		);
		expect(frame).toBeLessThan(CULLED_100K_FRAME_BUDGET_MS);
	});
});
