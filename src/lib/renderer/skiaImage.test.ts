import { beforeAll, describe, expect, it } from 'vitest';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { SkiaTracker } from './ownership';
import { pngBytes } from './pngFixture';
import { decodeSkiaImage } from './skiaImage';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

describe('decodeSkiaImage', () => {
	it('decodes a png into a tracked image that is counted until deleted', async () => {
		const tracker = new SkiaTracker();
		const bytes = pngBytes(6, 4, () => [255, 0, 0, 255]);
		const image = await decodeSkiaImage(canvasKit, tracker, bytes);
		expect(image?.width()).toBe(6);
		expect(image?.height()).toBe(4);
		expect(tracker.liveCount).toBe(1);
		image?.delete();
		expect(tracker.liveCount).toBe(0);
	});

	it('returns null for bytes that are not an image, leaving nothing alive', async () => {
		const tracker = new SkiaTracker();
		const image = await decodeSkiaImage(canvasKit, tracker, new Uint8Array([1, 2, 3, 4]));
		expect(image).toBeNull();
		expect(tracker.liveCount).toBe(0);
	});
});
