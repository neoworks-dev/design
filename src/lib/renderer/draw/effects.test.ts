// Effects, blend, opacity, clip and masks (#37), drawn headless on the Effects and Masks frames of
// the scene fixture. Pixel probes sit well inside or outside shapes so antialiasing never decides;
// each effect also has a control render without the effect hooks, proving the pixel really is the
// effect's doing.

import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../../../plugins/scene-fixture/fixture';
import { loadCanvasKit, type CanvasKit } from '../canvaskit';
import { nodeWasmLocator } from '../canvaskit.node';
import { CanvasKitBackend } from '../canvaskitBackend';
import { SkiaTracker } from '../ownership';
import { StoreSceneSource } from '../storeSceneSource';
import { RenderSurface } from '../surface';
import type { FrameResult } from '../types';
import { EFFECT_DRAW_HOOKS } from './effects';
import { DrawHookRegistry } from './hooks';
import { PaintShaderFactory } from './paintShaders';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

type Color = [number, number, number];

interface Rendered {
	surface: RenderSurface;
	result: FrameResult;
	tracker: SkiaTracker;
}

function render(withEffects: boolean): Rendered {
	const tracker = new SkiaTracker();
	const surface = RenderSurface.offscreen(canvasKit, tracker, 1400, 1400);
	const hooks = new DrawHookRegistry();
	const shaders = new PaintShaderFactory(canvasKit, tracker, {
		peek: () => undefined,
		status: () => 'missing'
	});
	hooks.register({
		shaderForPaint: (context, paint, size) => shaders.shaderFor(context, paint, size)
	});
	if (withEffects) hooks.register(EFFECT_DRAW_HOOKS);
	const backend = new CanvasKitBackend(canvasKit, tracker, surface, hooks);
	const source = new StoreSceneSource(buildFixtureDocument(), { pageId: SHAPES_PAGE_ID });
	const result = backend.render({
		source,
		view: { x: 0, y: 0, scale: 1 },
		size: { width: 1400, height: 1400 },
		devicePixelRatio: 1
	});
	return { surface, result, tracker };
}

function pixelAt(rendered: Rendered, x: number, y: number): Color {
	const [red, green, blue] = rendered.surface.readPixels({ x, y, width: 1, height: 1 });
	return [red, green, blue];
}

function expectColor(actual: Color, expected: Color, tolerance = 4): void {
	for (let channel = 0; channel < 3; channel += 1) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
	}
}

const WHITE: Color = [255, 255, 255];
const BLUE: Color = [33, 117, 245];

let withEffects: Rendered;
let without: Rendered;

beforeAll(() => {
	withEffects = render(true);
	without = render(false);
});

describe('shadows', () => {
	it('drop shadow darkens the area below and right of the node, and not far away', () => {
		const [red] = pixelAt(withEffects, 80, 1096);
		expect(red).toBeLessThan(200);
		expectColor(pixelAt(without, 80, 1096), WHITE);
		expectColor(pixelAt(withEffects, 200, 1112), WHITE);
	});

	it('drop shadow is cut out under the node', () => {
		expectColor(pixelAt(withEffects, 80, 1040), BLUE);
	});

	it('spread grows the shadow beyond the node on every side', () => {
		const [red] = pixelAt(withEffects, 506, 1040);
		expect(red).toBeLessThan(140);
		expectColor(pixelAt(without, 506, 1040), WHITE);
		expectColor(pixelAt(withEffects, 495, 1040), WHITE);
	});

	it('inner shadow darkens the edge inside the node and leaves its centre alone', () => {
		const pale: Color = [230, 238, 255];
		const edge = pixelAt(withEffects, 200, 996);
		expect(edge[0]).toBeLessThan(pale[0] - 40);
		expectColor(pixelAt(without, 200, 996), pale);
		expectColor(pixelAt(withEffects, 200, 1060), pale);
		expectColor(pixelAt(withEffects, 200, 1094), WHITE);
	});
});

describe('blurs', () => {
	it('layer blur spills the node colour outside its shape and softens it inside', () => {
		const [, greenOutside] = pixelAt(withEffects, 320, 986);
		expect(greenOutside).toBeLessThan(245);
		expectColor(pixelAt(without, 320, 986), WHITE);
		const [, greenEdge] = pixelAt(withEffects, 320, 993);
		expect(greenEdge).toBeGreaterThan(pixelAt(without, 320, 993)[1] + 3);
	});

	it('background blur smears the content behind the node, only inside the node', () => {
		const insideBlurred = pixelAt(withEffects, 440, 1022);
		expect(insideBlurred[1]).toBeLessThan(235);
		expectColor(pixelAt(without, 440, 1022), WHITE);
		expectColor(pixelAt(withEffects, 395, 1022), WHITE);
	});
});

describe('opacity, blend, clip', () => {
	it('opacity composites the node over what is behind', () => {
		const [red, green, blue] = pixelAt(withEffects, 100, 1200);
		expectColor([red, green, blue], [135, 92, 150], 6);
	});

	it('multiply blends with the backdrop', () => {
		expectColor(pixelAt(withEffects, 280, 1220), [0, 171, 51], 6);
		expectColor(pixelAt(withEffects, 320, 1220), [0, 204, 255], 6);
	});

	it('clipsContent cuts the child at the frame edge and off lets it overflow', () => {
		expectColor(pixelAt(withEffects, 495, 1200), WHITE);
		expectColor(pixelAt(withEffects, 470, 1200), [237, 66, 54]);
		expectColor(pixelAt(withEffects, 620, 1200), [237, 66, 54]);
	});
});

describe('masks', () => {
	it('an alpha mask keeps the content only where the mask has alpha, and is itself invisible', () => {
		expectColor(pixelAt(withEffects, 790, 1040), BLUE);
		expectColor(pixelAt(withEffects, 735, 1040), WHITE);
	});

	it('a vector mask uses the outline only: no stroke shows and the fill is ignored', () => {
		expectColor(pixelAt(withEffects, 940, 1040), BLUE);
		expectColor(pixelAt(withEffects, 885, 1040), WHITE);
		expectColor(pixelAt(withEffects, 891 + 50, 1090 - 1), BLUE, 40);
	});

	it('a luminance mask fades the content from black (hidden) to white (shown)', () => {
		expectColor(pixelAt(withEffects, 1036, 1040), WHITE, 25);
		const middle = pixelAt(withEffects, 1090, 1040);
		expect(middle[0]).toBeGreaterThan(100);
		expect(middle[0]).toBeLessThan(200);
		expectColor(pixelAt(withEffects, 1146, 1040), BLUE, 40);
	});

	it('a mask never affects siblings below or outside its container', () => {
		expectColor(pixelAt(withEffects, 1230, 1040), [250, 214, 51]);
	});
});

describe('layer count', () => {
	// Measured on the whole Shapes page: opacity and multiply 1 each, each of the three masks 2
	// (content group and mask), the fills frame 3. Effects add one layer for the layer blur and
	// one for the background blur; shadows draw without layers.
	it('isolates only what needs it', () => {
		expect(without.result.layers).toBe(11);
		expect(withEffects.result.layers).toBe(13);
	});
});
