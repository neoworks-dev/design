// Headless export (#44), run in Node without a display on the Effects and Fills frames of the
// scene fixture. The golden PNG is stored in `golden/`; regenerate it with UPDATE_GOLDEN=1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SceneIndex } from '../document';
import { buildFixtureDocument, SHAPES_PAGE_ID } from '../../plugins/scene-fixture/fixture';
import { loadCanvasKit, type CanvasKit } from './canvaskit';
import { nodeWasmLocator } from './canvaskit.node';
import { EFFECT_DRAW_HOOKS } from './draw/effects';
import { DrawHookRegistry } from './draw/hooks';
import {
	ExportError,
	exportNode,
	MAX_EXPORT_SIDE,
	type ExportEnvironment,
	type ExportOptions
} from './exportNode';
import { SkiaTracker } from './ownership';
import { StoreSceneSource } from './storeSceneSource';

let canvasKit: CanvasKit;

beforeAll(async () => {
	canvasKit = await loadCanvasKit(nodeWasmLocator());
});

function environment(): ExportEnvironment {
	const hooks = new DrawHookRegistry();
	hooks.register(EFFECT_DRAW_HOOKS);
	const source = new StoreSceneSource(buildFixtureDocument(), { pageId: SHAPES_PAGE_ID });
	return {
		canvasKit,
		tracker: new SkiaTracker(),
		hooks,
		source,
		geometry: new SceneIndex(source.store)
	};
}

interface Decoded {
	width: number;
	height: number;
	pixels: Uint8Array;
}

function decode(bytes: Uint8Array): Decoded {
	const image = canvasKit.MakeImageFromEncoded(bytes);
	if (image === null) throw new Error('not decodable');
	const width = image.width();
	const height = image.height();
	const pixels = image.readPixels(0, 0, {
		width,
		height,
		colorType: canvasKit.ColorType.RGBA_8888,
		alphaType: canvasKit.AlphaType.Unpremul,
		colorSpace: canvasKit.ColorSpace.SRGB
	});
	image.delete();
	if (!(pixels instanceof Uint8Array)) throw new Error('no pixels');
	return { width, height, pixels };
}

function pixelAt(image: Decoded, x: number, y: number): number[] {
	const offset = (y * image.width + x) * 4;
	return Array.from(image.pixels.slice(offset, offset + 4));
}

function maxChannelDifference(first: Decoded, second: Decoded): number {
	let largest = 0;
	for (let index = 0; index < first.pixels.length; index += 1) {
		largest = Math.max(largest, Math.abs(first.pixels[index] - second.pixels[index]));
	}
	return largest;
}

async function decodedExport(id: string, options: ExportOptions = {}): Promise<Decoded> {
	const exported = await exportNode(environment(), id, options);
	return decode(exported.bytes);
}

describe('exportNode', () => {
	it('exports the Effects frame to a PNG that matches the golden image', async () => {
		const exported = await exportNode(environment(), 'frame-effects');
		expect(exported.mimeType).toBe('image/png');
		expect(exported.width).toBe(640);
		expect(exported.height).toBe(420);
		const goldenPath = path.join(import.meta.dirname, 'golden', 'effects-frame.png');
		if (process.env.UPDATE_GOLDEN === '1') {
			mkdirSync(path.dirname(goldenPath), { recursive: true });
			writeFileSync(goldenPath, exported.bytes);
		}
		expect(existsSync(goldenPath)).toBe(true);
		const golden = decode(new Uint8Array(readFileSync(goldenPath)));
		const actual = decode(exported.bytes);
		expect([actual.width, actual.height]).toEqual([golden.width, golden.height]);
		expect(maxChannelDifference(actual, golden)).toBeLessThanOrEqual(2);
	});

	it('exports at scale: twice the pixels, same picture', async () => {
		const small = await decodedExport('fx-opacity-back');
		const large = await decodedExport('fx-opacity-back', { scale: 2 });
		expect([large.width, large.height]).toEqual([small.width * 2, small.height * 2]);
		expect(pixelAt(large, 40, 40)).toEqual(pixelAt(small, 20, 20));
	});

	it('starts the picture at the node, wherever it sits on the page', async () => {
		const exported = await decodedExport('fx-opacity-back');
		const [red, green, blue, alpha] = pixelAt(exported, 10, 10);
		expect(alpha).toBe(255);
		expect(red).toBeGreaterThan(200);
		expect(green).toBeLessThan(100);
		expect(blue).toBeLessThan(100);
	});

	it('keeps the node opacity and adds a background only when asked', async () => {
		const bare = await decodedExport('fx-opacity-front', { useAbsoluteBounds: true });
		expect(pixelAt(bare, 5, 5)[3]).toBe(128);
		const backed = await decodedExport('fx-opacity-front', {
			useAbsoluteBounds: true,
			background: { r: 0, g: 0, b: 0, a: 1 }
		});
		expect(pixelAt(backed, 5, 5)[3]).toBe(255);
		expect(pixelAt(backed, 5, 5)[0]).toBeLessThan(30);
	});

	it('grows to the render bounds for effects unless the absolute bounds are asked for', async () => {
		const withShadow = await exportNode(environment(), 'fx-drop-shadow');
		const boxOnly = await exportNode(environment(), 'fx-drop-shadow', { useAbsoluteBounds: true });
		expect(withShadow.width).toBeGreaterThan(boxOnly.width);
		expect(boxOnly.width).toBe(100);
	});

	it('draws overlapping neighbours only when contentsOnly is off', async () => {
		const alone = await decodedExport('fx-opacity-back');
		const withNeighbours = await decodedExport('fx-opacity-back', { contentsOnly: false });
		// the half-transparent blue square overlaps the lower right of the red one
		expect(pixelAt(alone, 80, 80)[2]).toBeLessThan(100);
		expect(pixelAt(withNeighbours, 80, 80)[2]).toBeGreaterThan(100);
	});

	it('says so when the build cannot encode JPG or WEBP and no browser encoder exists', async () => {
		await expect(exportNode(environment(), 'fx-opacity-back', { format: 'JPG' })).rejects.toThrow(
			ExportError
		);
	});

	it('refuses exports beyond the size limit and unknown nodes, and leaks no Skia objects', async () => {
		const target = environment();
		await expect(exportNode(target, 'frame-effects', { scale: MAX_EXPORT_SIDE })).rejects.toThrow(
			ExportError
		);
		await expect(exportNode(target, 'missing')).rejects.toThrow(ExportError);
		await exportNode(target, 'frame-effects');
		expect(target.tracker.liveCount).toBe(0);
	});
});
