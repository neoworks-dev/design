// Draws the shapes page of the scene fixture through the headless CanvasKit backend and probes
// pixels. Tolerance: colors are compared per channel within 3/255 (antialiasing and rounding);
// shape tests probe pixels well inside or well outside an edge so antialiasing never decides.

import { beforeAll, describe, expect, it } from 'vitest';
import type { Node } from '../../document/types';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../../../plugins/scene-fixture/fixture';
import { loadCanvasKit, type CanvasKit } from '../canvaskit';
import { nodeWasmLocator } from '../canvaskit.node';
import { CanvasKitBackend } from '../canvaskitBackend';
import { SkiaTracker } from '../ownership';
import { StoreSceneSource } from '../storeSceneSource';
import { RenderSurface } from '../surface';
import type { FrameResult } from '../types';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

const WIDTH = 1400;
const HEIGHT = 920;

type Color = [number, number, number];
const WHITE: Color = [255, 255, 255];
const PALE: Color = [230, 238, 255];
const RED: Color = [237, 66, 54];
const INK: Color = [31, 31, 41];

interface Rendered {
	surface: RenderSurface;
	result: FrameResult;
	tracker: SkiaTracker;
	backend: CanvasKitBackend;
}

function render(source: StoreSceneSource, tracker = new SkiaTracker()): Rendered {
	const surface = RenderSurface.offscreen(canvasKit, tracker, WIDTH, HEIGHT);
	const backend = new CanvasKitBackend(canvasKit, tracker, surface);
	const result = renderFrame(backend, source);
	return { surface, result, tracker, backend };
}

function renderFrame(backend: CanvasKitBackend, source: StoreSceneSource): FrameResult {
	return backend.render({
		source,
		view: { x: 0, y: 0, scale: 1 },
		size: { width: WIDTH, height: HEIGHT },
		devicePixelRatio: 1
	});
}

function shapesSource(): StoreSceneSource {
	return new StoreSceneSource(buildFixtureDocument(), { pageId: SHAPES_PAGE_ID });
}

function pixelAt(surface: RenderSurface, x: number, y: number): Color {
	const [red, green, blue] = surface.readPixels({ x, y, width: 1, height: 1 });
	return [red, green, blue];
}

function expectColor(actual: Color, expected: Color, tolerance = 3): void {
	for (let channel = 0; channel < 3; channel += 1) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
	}
}

function expectPixel(rendered: Rendered, x: number, y: number, expected: Color): void {
	expectColor(pixelAt(rendered.surface, x, y), expected);
}

describe('node types', () => {
	let rendered: Rendered;
	beforeAll(() => {
		rendered = render(shapesSource());
	});

	it('draws a rectangle with per-corner radius: round corners are cut, square corners are not', () => {
		expectPixel(rendered, 200, 80, RED);
		expectPixel(rendered, 153, 33, WHITE);
		expectPixel(rendered, 248, 33, RED);
	});

	it('smoothing changes the corner curve relative to a plain circular radius', () => {
		// same radius, same box: only the corner curve differs, so some pixels on the first rows differ
		let differing = 0;
		for (let row = 0; row < 12; row += 1) {
			for (let column = 0; column < 40; column += 1) {
				const plain = pixelAt(rendered.surface, 270 + column, 30 + row);
				const smooth = pixelAt(rendered.surface, 390 + column, 30 + row);
				if (plain[0] !== smooth[0]) differing += 1;
			}
		}
		expect(differing).toBeGreaterThan(10);
	});

	it('draws an ellipse, a pie, a ring and an arc ring', () => {
		expectPixel(rendered, 560, 80, [250, 179, 26]);
		expectPixel(rendered, 513, 33, WHITE);
		expectPixel(rendered, 40, 210, [140, 77, 230]);
		expectPixel(rendered, 120, 210, WHITE);
		expectPixel(rendered, 240, 210, [250, 102, 166]);
		expectPixel(rendered, 200, 210, WHITE);
		expectPixel(rendered, 320, 250, [26, 179, 179]);
		expectPixel(rendered, 320, 170, WHITE);
	});

	it('draws a polygon, a star and rounded variants', () => {
		expectPixel(rendered, 440, 210, [250, 128, 26]);
		expectPixel(rendered, 392, 162, WHITE);
		expectPixel(rendered, 560, 210, [250, 214, 51]);
		expectPixel(rendered, 583, 178, WHITE);
		expectPixel(rendered, 80, 340, RED);
		expectPixel(rendered, 200, 330, [33, 117, 245]);
	});

	it('draws a vector network: filled closed regions, open networks only stroked', () => {
		expectPixel(rendered, 330, 340, [140, 77, 230]);
		expectPixel(rendered, 273, 283, WHITE);
		expectPixel(rendered, 430, 335, INK);
		expectPixel(rendered, 450, 335, WHITE);
	});

	it('draws a rotated line with round caps', () => {
		expectPixel(rendered, 585, 310, INK);
		expectPixel(rendered, 585, 330, WHITE);
	});

	it('clips frame children to the frame, unless clipsContent is off', () => {
		expectPixel(rendered, 1160, 330, [250, 102, 166]);
		expectPixel(rendered, 1195, 330, WHITE);
		expectPixel(rendered, 1330, 330, [250, 102, 166]);
	});
});

describe('strokes', () => {
	let rendered: Rendered;
	beforeAll(() => {
		rendered = render(shapesSource());
	});

	it('inside alignment stays within the edge, outside beyond it, center straddles it', () => {
		// stroke-inside spans x 30..130, stroke-center 150..250, stroke-outside 270..370 at y 510..610
		expectPixel(rendered, 38, 560, RED);
		expectPixel(rendered, 22, 560, WHITE);
		expectPixel(rendered, 80, 560, PALE);
		expectPixel(rendered, 146, 560, RED);
		expectPixel(rendered, 154, 560, RED);
		expectPixel(rendered, 162, 560, PALE);
		expectPixel(rendered, 262, 560, RED);
		expectPixel(rendered, 278, 560, PALE);
	});

	it('inside alignment follows rounded corners', () => {
		expectPixel(rendered, 392, 512, WHITE);
		expectPixel(rendered, 440, 517, RED);
	});

	it('dashes alternate stroke and gap along the path', () => {
		let stroked = 0;
		const samples = 88;
		for (let offset = 0; offset < samples; offset += 1) {
			const [red, green] = pixelAt(rendered.surface, 36 + offset, 640);
			if (red > 200 && green < 120) stroked += 1;
		}
		const share = stroked / samples;
		expect(share).toBeGreaterThan(0.45);
		expect(share).toBeLessThan(0.8);
	});

	it('round-capped zero-length dashes draw dots', () => {
		expectPixel(rendered, 418, 820, INK);
		expectPixel(rendered, 409, 820, WHITE);
	});

	it('draws per-side weights: only the sides with weight', () => {
		expectPixel(rendered, 320, 642, RED);
		expectPixel(rendered, 320, 647, PALE);
		expectPixel(rendered, 360, 690, RED);
		expectPixel(rendered, 340, 690, PALE);
		expectPixel(rendered, 320, 735, RED);
		expectPixel(rendered, 320, 722, PALE);
		expectPixel(rendered, 275, 690, PALE);
	});

	it('draws several strokes in order, the later one on top', () => {
		expectPixel(rendered, 383, 690, [33, 117, 245]);
		const [red] = pixelAt(rendered.surface, 390, 690);
		expect(red).toBeGreaterThan(150);
	});

	it('flat, square and round caps extend the line by 0, half a weight and a half circle', () => {
		expectPixel(rendered, 275, 790, WHITE);
		expectPixel(rendered, 275, 860, INK);
		expectPixel(rendered, 275, 825, INK);
		expectPixel(rendered, 272, 818, WHITE);
		expectPixel(rendered, 285, 790, INK);
	});
});

describe('opacity, blend and multiple fills', () => {
	let rendered: Rendered;
	beforeAll(() => {
		rendered = render(shapesSource());
	});

	it('stacks fills bottom to top', () => {
		expectPixel(rendered, 800, 100, [182, 156, 110]);
	});

	it('node opacity blends the node over what is below', () => {
		expectPixel(rendered, 1000, 100, [83, 130, 168]);
	});

	it('group opacity composites the subtree as a unit', () => {
		expectPixel(rendered, 1160, 110, [156, 193, 250]);
	});

	it('uses one layer per node that is composited: opacity, group opacity, blend mode', () => {
		expect(rendered.result.layers).toBe(3);
	});
});

describe('resolved values', () => {
	it('draws what the scene source resolves, not the stored property', () => {
		let brand: Color = [0, 0, 255];
		const resolve = <T extends Node>(node: T): T => {
			if (node.id !== 'fills-variable' || !('fills' in node)) return node;
			const [red, green, blue] = brand;
			const fills = node.fills.map((paint) => {
				if (paint.type !== 'SOLID') return paint;
				return { ...paint, color: { r: red / 255, g: green / 255, b: blue / 255 } };
			});
			return { ...node, fills };
		};
		const source = new StoreSceneSource(buildFixtureDocument(), {
			pageId: SHAPES_PAGE_ID,
			resolve
		});
		const first = render(source);
		expectPixel(first, 960, 290, [0, 0, 255]);
		brand = [255, 128, 0];
		source.notifyReset();
		renderFrame(first.backend, source);
		expectPixel(first, 960, 290, [255, 128, 0]);
	});
});

describe('ownership', () => {
	it('leaves only the surface alive after each frame and allocates the same every frame', () => {
		const tracker = new SkiaTracker();
		const source = shapesSource();
		const { backend } = render(source, tracker);
		expect(tracker.liveCount).toBe(1);
		const createdPerFrame: number[] = [];
		for (let frame = 0; frame < 4; frame += 1) {
			const before = tracker.createdCount;
			renderFrame(backend, source);
			createdPerFrame.push(tracker.createdCount - before);
			expect(tracker.liveCount).toBe(1);
		}
		expect(new Set(createdPerFrame).size).toBe(1);
	});
});
