import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import { solid, translation } from '../../plugins/scene-fixture/fixture';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { CanvasKitBackend } from './canvaskitBackend';
import { SkiaTracker } from './ownership';
import { StoreSceneSource } from './storeSceneSource';
import { RenderSurface } from './surface';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

function sceneSource(): StoreSceneSource {
	return new StoreSceneSource(
		buildDocument([
			page(
				'P',
				[
					frame({ id: 'f', width: 100, height: 100, fills: [solid(1, 1, 1)] }, [
						rectangle({
							id: 'r',
							width: 40,
							height: 40,
							transform: translation(10, 10),
							fills: [solid(1, 0, 0)]
						})
					])
				],
				{ id: 'p' }
			)
		])
	);
}

function pixelAt(surface: RenderSurface, x: number, y: number): number[] {
	return [...surface.readPixels({ x, y, width: 1, height: 1 })];
}

describe('CanvasKitBackend', () => {
	it('draws the page background, then the nodes through the camera and device pixel ratio', () => {
		const tracker = new SkiaTracker();
		const surface = RenderSurface.offscreen(canvasKit, tracker, 200, 200);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		const result = backend.render({
			source: sceneSource(),
			view: { x: 20, y: 30, scale: 2 },
			size: { width: 100, height: 100 },
			devicePixelRatio: 2
		});
		expect(result.drawn).toBe(true);
		expect(result.drawnNodes).toBe(2);
		// page background #f5f5f5 outside the frame, white frame, red rectangle
		expect(pixelAt(surface, 2, 2)).toEqual([245, 245, 245, 255]);
		// world (5, 5) -> css (5*2+20, 5*2+30) = (30, 40) -> pixels (60, 80)
		expect(pixelAt(surface, 60, 80)).toEqual([255, 255, 255, 255]);
		// world (30, 30) is inside the red rectangle -> css (80, 90) -> pixels (160, 180)
		expect(pixelAt(surface, 160, 180)).toEqual([255, 0, 0, 255]);
		backend.dispose();
	});

	it('leaves no Skia objects alive after a frame and after dispose', () => {
		const tracker = new SkiaTracker();
		const surface = RenderSurface.offscreen(canvasKit, tracker, 64, 64);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		const source = sceneSource();
		for (let frameNumber = 0; frameNumber < 5; frameNumber += 1) {
			backend.render({
				source,
				view: { x: 0, y: 0, scale: 1 },
				size: { width: 64, height: 64 },
				devicePixelRatio: 1
			});
			expect(tracker.liveCount).toBe(1);
		}
		backend.dispose();
		expect(tracker.liveCount).toBe(0);
	});

	it('reports not drawn when the surface has been disposed', () => {
		const tracker = new SkiaTracker();
		const surface = RenderSurface.offscreen(canvasKit, tracker, 8, 8);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		backend.dispose();
		const result = backend.render({
			source: sceneSource(),
			view: { x: 0, y: 0, scale: 1 },
			size: { width: 8, height: 8 },
			devicePixelRatio: 1
		});
		expect(result.drawn).toBe(false);
	});
});

describe('pixel preview', () => {
	function renderAt(pixelPreview: boolean): RenderSurface {
		const tracker = new SkiaTracker();
		const surface = RenderSurface.offscreen(canvasKit, tracker, 400, 400);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		const halfPixelRectangle = new StoreSceneSource(
			buildDocument([
				page(
					'P',
					[
						rectangle({
							id: 'edge',
							width: 20,
							height: 20,
							transform: translation(10.5, 10),
							fills: [solid(0, 0, 0)]
						})
					],
					{ id: 'p' }
				)
			])
		);
		backend.render({
			source: halfPixelRectangle,
			view: { x: 0, y: 0, scale: 8 },
			size: { width: 400, height: 400 },
			devicePixelRatio: 1,
			pixelPreview
		});
		return surface;
	}

	it('draws the half covered edge pixel as one whole 8 x 8 square instead of a sharp edge', () => {
		const preview = renderAt(true);
		// world x 10 (screen 80..87) is half covered at 1x: the same grey for all 8 screen pixels
		const inside = pixelAt(preview, 84, 120)[0];
		expect(inside).toBeGreaterThan(100);
		expect(inside).toBeLessThan(160);
		for (let column = 80; column < 88; column += 1) {
			expect(pixelAt(preview, column, 120)[0]).toBe(inside);
		}
		// the next world pixel is fully covered
		expect(pixelAt(preview, 90, 120)[0]).toBe(0);
	});

	it('is a sharp edge at the real position without the preview', () => {
		const normal = renderAt(false);
		// the edge is at screen x 84: left of it the page, right of it black
		expect(pixelAt(normal, 82, 120)[0]).toBe(245);
		expect(pixelAt(normal, 86, 120)[0]).toBe(0);
	});

	it('does nothing at or below 100%', () => {
		const tracker = new SkiaTracker();
		const surface = RenderSurface.offscreen(canvasKit, tracker, 200, 200);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		const result = backend.render({
			source: sceneSource(),
			view: { x: 0, y: 0, scale: 1 },
			size: { width: 200, height: 200 },
			devicePixelRatio: 1,
			pixelPreview: true
		});
		expect(result.drawn).toBe(true);
		expect(pixelAt(surface, 20, 20)).toEqual([255, 0, 0, 255]);
		expect(tracker.liveCount).toBe(1);
	});
});

describe('pan snapshot', () => {
	function allPixels(surface: RenderSurface): number[] {
		return [...surface.readPixels({ x: 0, y: 0, width: 120, height: 120 })];
	}

	function renderPair(view: { x: number; y: number; scale: number }): {
		shifted: number[];
		direct: number[];
		fromSnapshot: boolean | undefined;
	} {
		const tracker = new SkiaTracker();
		const source = sceneSource();
		const size = { width: 120, height: 120 };
		const panned = RenderSurface.offscreen(canvasKit, tracker, 120, 120);
		const panning = new CanvasKitBackend(canvasKit, tracker, panned);
		panning.render({ source, view: { x: 0, y: 0, scale: 1 }, size, devicePixelRatio: 1 });
		panning.render({
			source,
			view: { x: 2, y: 3, scale: 1 },
			size,
			devicePixelRatio: 1,
			panOnly: true
		});
		const result = panning.render({ source, view, size, devicePixelRatio: 1, panOnly: true });
		const fresh = RenderSurface.offscreen(canvasKit, tracker, 120, 120);
		const direct = new CanvasKitBackend(canvasKit, tracker, fresh);
		direct.render({ source, view, size, devicePixelRatio: 1 });
		const pixels = {
			shifted: allPixels(panned),
			direct: allPixels(fresh),
			fromSnapshot: result.fromSnapshot
		};
		panning.dispose();
		direct.dispose();
		expect(tracker.liveCount).toBe(0);
		return pixels;
	}

	it('pans by shifting the snapshot, pixel-identical to drawing the scene', () => {
		const pair = renderPair({ x: 17, y: -11, scale: 1 });
		expect(pair.fromSnapshot).toBe(true);
		expect(pair.shifted).toEqual(pair.direct);
	});

	it('takes a new snapshot when the pan leaves the old one', () => {
		const pair = renderPair({ x: 200, y: 0, scale: 1 });
		expect(pair.fromSnapshot).toBe(true);
		expect(pair.shifted).toEqual(pair.direct);
	});

	it('draws for real while zooming', () => {
		const pair = renderPair({ x: 17, y: -11, scale: 2 });
		expect(pair.fromSnapshot).toBeUndefined();
		expect(pair.shifted).toEqual(pair.direct);
	});

	it('drops the snapshot on any frame that is not a pure pan', () => {
		const tracker = new SkiaTracker();
		const source = sceneSource();
		const size = { width: 120, height: 120 };
		const surface = RenderSurface.offscreen(canvasKit, tracker, 120, 120);
		const backend = new CanvasKitBackend(canvasKit, tracker, surface);
		backend.render({ source, view: { x: 0, y: 0, scale: 1 }, size, devicePixelRatio: 1 });
		backend.render({
			source,
			view: { x: 1, y: 0, scale: 1 },
			size,
			devicePixelRatio: 1,
			panOnly: true
		});
		const live = tracker.liveCount;
		backend.render({ source, view: { x: 5, y: 0, scale: 1 }, size, devicePixelRatio: 1 });
		expect(tracker.liveCount).toBeLessThan(live);
		const after = backend.render({
			source,
			view: { x: 6, y: 0, scale: 1 },
			size,
			devicePixelRatio: 1,
			panOnly: true
		});
		expect(after.fromSnapshot).toBe(true);
		backend.invalidate('everything');
		backend.dispose();
		expect(tracker.liveCount).toBe(0);
	});
});
