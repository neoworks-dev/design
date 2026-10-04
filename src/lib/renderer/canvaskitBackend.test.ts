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
