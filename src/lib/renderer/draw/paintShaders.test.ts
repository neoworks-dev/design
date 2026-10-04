// Gradient and image paints through the headless CanvasKit backend, probed by pixel. Tolerance:
// 6/255 per channel for gradients (interpolation and rounding), 3/255 for flat image bands; probes
// stay away from band edges so filtering never decides. Cells are 100 x 100 boxes on a white
// frame, five per row, 120 apart.

import type { Image } from 'canvaskit-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../../document/fixtures';
import type {
	ColorStop,
	GradientPaint,
	ImagePaint,
	Matrix2x3,
	Paint,
	Stroke
} from '../../document/types';
import { loadCanvasKit, type CanvasKit } from '../canvaskit';
import { nodeWasmLocator } from '../canvaskit.node';
import { CanvasKitBackend } from '../canvaskitBackend';
import { DrawHookRegistry } from './hooks';
import { SkiaTracker } from '../ownership';
import { pngBytes } from '../pngFixture';
import { decodeSkiaImage } from '../skiaImage';
import { StoreSceneSource } from '../storeSceneSource';
import { RenderSurface } from '../surface';
import { imageMatrix, PaintShaderFactory, type ImageSource } from './paintShaders';

let canvasKit: CanvasKit;
let stripes: Image;
const imageTracker = new SkiaTracker();

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
	// 30 x 20: red for x < 10, green for x < 20, blue after
	const bytes = pngBytes(30, 20, (x) => {
		if (x < 10) return [255, 0, 0, 255];
		if (x < 20) return [0, 255, 0, 255];
		return [0, 0, 255, 255];
	});
	const decoded = await decodeSkiaImage(canvasKit, imageTracker, bytes);
	if (decoded === null) throw new Error('fixture image did not decode');
	stripes = decoded;
});

afterAll(() => stripes.delete());

type Color = [number, number, number];
const WHITE: Color = [255, 255, 255];
const RED: Color = [255, 0, 0];
const GREEN: Color = [0, 255, 0];
const BLUE: Color = [0, 0, 255];

const IDENTITY: Matrix2x3 = [
	[1, 0, 0],
	[0, 1, 0]
];

function stop(position: number, red: number, green: number, blue: number, alpha = 1): ColorStop {
	return { position, color: { r: red, g: green, b: blue, a: alpha } };
}

function gradient(
	type: GradientPaint['type'],
	stops: ColorStop[],
	transform: Matrix2x3 = IDENTITY,
	opacity = 1
): GradientPaint {
	return {
		type,
		visible: true,
		opacity,
		blendMode: 'NORMAL',
		gradientTransform: transform,
		gradientStops: stops
	};
}

function imagePaint(
	hash: string,
	scaleMode: ImagePaint['scaleMode'],
	extra: Partial<ImagePaint> = {}
): ImagePaint {
	return {
		type: 'IMAGE',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		imageHash: hash,
		scaleMode,
		...extra
	};
}

function stroke(paint: Paint): Stroke {
	return {
		paints: [paint],
		weight: 20,
		align: 'INSIDE',
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

const COLUMNS = 5;
const STEP = 120;

function cellOrigin(index: number): { x: number; y: number } {
	return { x: 10 + STEP * (index % COLUMNS), y: 10 + STEP * Math.floor(index / COLUMNS) };
}

interface Cell {
	fills?: Paint[];
	strokes?: Stroke[];
}

interface Rendered {
	surface: RenderSurface;
	tracker: SkiaTracker;
	backend: CanvasKitBackend;
	factory: PaintShaderFactory;
	source: StoreSceneSource;
}

const imageSource: ImageSource = {
	peek: (hash) => {
		if (hash === 'stripes') return stripes;
		return undefined;
	},
	status: (hash) => {
		if (hash === 'stripes') return 'ready';
		if (hash === 'decoding') return 'loading';
		return 'missing';
	}
};

function renderCells(cells: Cell[]): Rendered {
	const children = cells.map((cell, index) => {
		const { x, y } = cellOrigin(index);
		return rectangle({
			id: `cell-${index}`,
			width: 100,
			height: 100,
			transform: [
				[1, 0, x],
				[0, 1, y]
			],
			fills: cell.fills ?? [],
			strokes: cell.strokes ?? []
		});
	});
	const document = buildDocument([
		page('P', [frame({ id: 'f', width: 640, height: 400, fills: [solidWhite()] }, children)], {
			id: 'p'
		})
	]);
	const source = new StoreSceneSource(document);
	const tracker = new SkiaTracker();
	const surface = RenderSurface.offscreen(canvasKit, tracker, 640, 400);
	const factory = new PaintShaderFactory(canvasKit, tracker, imageSource);
	const hooks = new DrawHookRegistry();
	hooks.register({
		shaderForPaint: (context, paint, size) => factory.shaderFor(context, paint, size)
	});
	const backend = new CanvasKitBackend(canvasKit, tracker, surface, hooks);
	renderOnce(backend, source);
	return { surface, tracker, backend, factory, source };
}

function renderOnce(backend: CanvasKitBackend, source: StoreSceneSource): void {
	backend.render({
		source,
		view: { x: 0, y: 0, scale: 1 },
		size: { width: 640, height: 400 },
		devicePixelRatio: 1
	});
}

function solidWhite(): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: 1, g: 1, b: 1 }
	};
}

function probe(rendered: Rendered, cell: number, x: number, y: number): Color {
	const origin = cellOrigin(cell);
	const [red, green, blue] = rendered.surface.readPixels({
		x: origin.x + x,
		y: origin.y + y,
		width: 1,
		height: 1
	});
	return [red, green, blue];
}

function expectColor(actual: Color, expected: Color, tolerance = 6): void {
	for (let channel = 0; channel < 3; channel += 1) {
		expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
	}
}

describe('gradients', () => {
	let rendered: Rendered;
	const redToBlue = [stop(0, 1, 0, 0), stop(1, 0, 0, 1)];

	beforeAll(() => {
		const yellowToRed = [stop(0, 1, 1, 0), stop(1, 1, 0, 0)];
		const diagonal: Matrix2x3 = [
			[0.5, 0.5, 0],
			[-0.5, 0.5, 0.5]
		];
		rendered = renderCells([
			{ fills: [gradient('GRADIENT_LINEAR', redToBlue)] },
			{ fills: [gradient('GRADIENT_LINEAR', redToBlue, diagonal)] },
			{ fills: [gradient('GRADIENT_RADIAL', yellowToRed)] },
			{
				fills: [
					gradient('GRADIENT_ANGULAR', [stop(0, 1, 0, 0), stop(0.5, 0, 0, 1), stop(1, 1, 0, 0)])
				]
			},
			{ fills: [gradient('GRADIENT_DIAMOND', yellowToRed)] },
			{ fills: [gradient('GRADIENT_LINEAR', redToBlue, IDENTITY, 0.5)] },
			{ strokes: [stroke(gradient('GRADIENT_LINEAR', redToBlue))] },
			{ fills: [gradient('GRADIENT_LINEAR', [stop(0, 1, 0, 0, 1), stop(1, 1, 0, 0, 0)])] },
			{ fills: [gradient('GRADIENT_LINEAR', [stop(1, 0, 0, 1), stop(0, 1, 0, 0)])] },
			{ fills: [gradient('GRADIENT_LINEAR', [])] },
			{
				fills: [
					gradient('GRADIENT_LINEAR', redToBlue, [
						[0, 0, 0],
						[0, 0, 0]
					])
				]
			},
			{
				fills: [
					gradient('GRADIENT_DIAMOND', [stop(0, 1, 0, 0), stop(0.5, 0, 1, 0), stop(1, 0, 0, 1)])
				]
			}
		]);
	});

	it('linear: interpolates along the gradient line', () => {
		expectColor(probe(rendered, 0, 5, 50), [241, 0, 14]);
		expectColor(probe(rendered, 0, 50, 50), [127, 0, 128]);
		expectColor(probe(rendered, 0, 95, 80), [14, 0, 241]);
	});

	it('linear: the gradient transform turns the line (top-left to bottom-right)', () => {
		expectColor(probe(rendered, 1, 4, 4), [244, 0, 11]);
		expectColor(probe(rendered, 1, 96, 96), [11, 0, 244]);
		expectColor(probe(rendered, 1, 96, 4), [127, 0, 128]);
	});

	it('radial: first stop in the center, last stop from the radius outwards', () => {
		expectColor(probe(rendered, 2, 50, 50), [255, 255, 0]);
		expectColor(probe(rendered, 2, 95, 50), [255, 26, 0]);
		expectColor(probe(rendered, 2, 4, 4), RED);
	});

	it('angular: sweeps around the center', () => {
		expectColor(probe(rendered, 3, 95, 50), RED, 12);
		expectColor(probe(rendered, 3, 5, 50), BLUE, 12);
		expectColor(probe(rendered, 3, 50, 95), [128, 0, 128], 12);
		expectColor(probe(rendered, 3, 50, 5), [128, 0, 128], 12);
	});

	it('diamond: equal distance in the taxicab metric gives equal colors', () => {
		expectColor(probe(rendered, 4, 50, 50), [255, 255, 0]);
		const along = probe(rendered, 4, 50, 20);
		const diagonal = probe(rendered, 4, 35, 35);
		expectColor(along, diagonal, 10);
		expectColor(probe(rendered, 4, 4, 4), RED);
	});

	it('diamond: three stops, the middle stop at half the way out', () => {
		expectColor(probe(rendered, 11, 50, 50), RED, 14);
		expectColor(probe(rendered, 11, 50, 25), GREEN, 8);
		expectColor(probe(rendered, 11, 4, 4), BLUE);
	});

	it('paint opacity blends the gradient over what is below', () => {
		expectColor(probe(rendered, 5, 5, 50), [248, 128, 135]);
	});

	it('strokes can use gradient paints', () => {
		expectColor(probe(rendered, 6, 5, 50), [241, 0, 14], 12);
		expectColor(probe(rendered, 6, 95, 50), [14, 0, 241], 12);
		expectColor(probe(rendered, 6, 50, 50), WHITE);
	});

	it('stop alpha makes the gradient fade to what is below', () => {
		expectColor(probe(rendered, 7, 5, 50), [255, 14, 14]);
		expectColor(probe(rendered, 7, 95, 50), [255, 241, 241]);
	});

	it('stops are used in position order regardless of how they are stored', () => {
		expectColor(probe(rendered, 8, 5, 50), [241, 0, 14]);
		expectColor(probe(rendered, 8, 95, 50), [14, 0, 241]);
	});

	it('draws nothing for a gradient without stops or with a singular transform, and does not throw', () => {
		expectColor(probe(rendered, 9, 50, 50), WHITE);
		expectColor(probe(rendered, 10, 50, 50), WHITE);
	});
});

describe('image paints', () => {
	let rendered: Rendered;

	beforeAll(() => {
		const zoom: Matrix2x3 = [
			[0.5, 0, 0.25],
			[0, 0.5, 0.25]
		];
		rendered = renderCells([
			{ fills: [imagePaint('stripes', 'FILL')] },
			{ fills: [imagePaint('stripes', 'FIT')] },
			{ fills: [imagePaint('stripes', 'CROP', { imageTransform: zoom })] },
			{ fills: [imagePaint('stripes', 'TILE', { scalingFactor: 2 })] },
			{ fills: [imagePaint('stripes', 'FILL', { rotation: 90 })] },
			{ fills: [imagePaint('absent', 'FILL')] },
			{ fills: [imagePaint('decoding', 'FILL')] },
			{ fills: [imagePaint('stripes', 'FILL', { opacity: 0.5 } as Partial<ImagePaint>)] }
		]);
	});

	it('fill: covers the box, centered, cropping what overflows', () => {
		expectColor(probe(rendered, 0, 10, 50), RED, 3);
		expectColor(probe(rendered, 0, 50, 50), GREEN, 3);
		expectColor(probe(rendered, 0, 90, 50), BLUE, 3);
		expectColor(probe(rendered, 0, 50, 4), GREEN, 3);
	});

	it('fit: contains the whole image, leaving the rest of the box empty', () => {
		expectColor(probe(rendered, 1, 15, 50), RED, 3);
		expectColor(probe(rendered, 1, 50, 50), GREEN, 3);
		expectColor(probe(rendered, 1, 85, 50), BLUE, 3);
		expectColor(probe(rendered, 1, 50, 6), WHITE);
		expectColor(probe(rendered, 1, 50, 94), WHITE);
	});

	it('crop: places the image by imageTransform (the same box differs from fill at x = 20)', () => {
		expectColor(probe(rendered, 2, 8, 50), RED, 3);
		expectColor(probe(rendered, 2, 20, 50), GREEN, 3);
		expectColor(probe(rendered, 2, 92, 50), BLUE, 3);
		expectColor(probe(rendered, 0, 20, 50), RED, 3);
	});

	it('tile: repeats the image at the scaling factor from the top-left corner', () => {
		expectColor(probe(rendered, 3, 10, 10), RED, 3);
		expectColor(probe(rendered, 3, 30, 10), GREEN, 3);
		expectColor(probe(rendered, 3, 50, 10), BLUE, 3);
		expectColor(probe(rendered, 3, 70, 10), RED, 3);
		expectColor(probe(rendered, 3, 10, 50), RED, 3);
	});

	it('rotation turns the image before it is placed', () => {
		expectColor(probe(rendered, 4, 50, 10), RED, 3);
		expectColor(probe(rendered, 4, 50, 50), GREEN, 3);
		expectColor(probe(rendered, 4, 50, 90), BLUE, 3);
	});

	it('a missing image draws a placeholder and does not throw; a decoding one a different one', () => {
		expectColor(probe(rendered, 5, 50, 50), [245, 199, 204], 3);
		expectColor(probe(rendered, 6, 50, 50), [224, 224, 230], 3);
	});

	it('paint opacity applies to image paints', () => {
		expectColor(probe(rendered, 7, 10, 50), [255, 128, 128], 4);
	});
});

describe('imageMatrix', () => {
	const paint = imagePaint('x', 'FILL');

	it('fill scales by the larger ratio and centers; fit by the smaller', () => {
		expect(imageMatrix(paint, 30, 20, { width: 100, height: 100 })).toEqual([
			[5, 0, -25],
			[0, 5, 0]
		]);
		const fit = imageMatrix(imagePaint('x', 'FIT'), 30, 20, { width: 100, height: 100 });
		expect(fit?.[0][0]).toBeCloseTo(100 / 30, 9);
		expect(fit?.[1][2]).toBeCloseTo((100 - 20 * (100 / 30)) / 2, 9);
	});

	it('refuses to place an image in an empty box or with a singular crop transform', () => {
		expect(imageMatrix(paint, 30, 20, { width: 0, height: 100 })).toBeNull();
		const singular = imagePaint('x', 'CROP', {
			imageTransform: [
				[0, 0, 0],
				[0, 0, 0]
			]
		});
		expect(imageMatrix(singular, 30, 20, { width: 10, height: 10 })).toBeNull();
	});
});

describe('ownership', () => {
	it('frees every shader each frame; only the surface and the compiled diamond effect stay', () => {
		const rendered = renderCells([
			{ fills: [gradient('GRADIENT_DIAMOND', [stop(0, 1, 0, 0), stop(1, 0, 0, 1)])] },
			{ fills: [gradient('GRADIENT_RADIAL', [stop(0, 1, 0, 0), stop(1, 0, 0, 1)])] },
			{ fills: [imagePaint('stripes', 'TILE')] }
		]);
		expect(rendered.tracker.liveCount).toBe(2);
		const created: number[] = [];
		for (let frameNumber = 0; frameNumber < 3; frameNumber += 1) {
			const before = rendered.tracker.createdCount;
			renderOnce(rendered.backend, rendered.source);
			created.push(rendered.tracker.createdCount - before);
			expect(rendered.tracker.liveCount).toBe(2);
		}
		expect(new Set(created).size).toBe(1);
		rendered.factory.dispose();
		expect(rendered.tracker.liveCount).toBe(1);
	});
});
