import { describe, expect, it } from 'vitest';
import { composeMatrices, createNode, transformPoint, type ImagePaint } from '../document';
import { imageMatrix } from '../renderer/draw/paintShaders';
import { clampToImage, cropToRect, imageOutline, moveImage } from './imageCrop';
import type { PositionedNode } from './selectionOps';

const IMAGE = { width: 200, height: 100 };

function fill(): ImagePaint {
	return {
		type: 'IMAGE',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		imageHash: 'h',
		scaleMode: 'FILL'
	};
}

/** A 100 x 100 node at (10, 20) whose FILL image covers it: scaled 1, centred, 50 px cut each side. */
function squareNode(): PositionedNode {
	return createNode('RECTANGLE', {
		width: 100,
		height: 100,
		transform: [
			[1, 0, 10],
			[0, 1, 20]
		],
		fills: [fill()]
	});
}

function paintOf(props: { fills: unknown }): ImagePaint {
	const [paint] = props.fills as ImagePaint[];
	return paint;
}

/** Where image pixel (px, py) lies in the world for a node and its (possibly cropped) paint. */
function worldOfPixel(
	node: { transform: PositionedNode['transform']; width: number; height: number },
	paint: ImagePaint,
	pixel: { x: number; y: number }
): { x: number; y: number } {
	const matrix = imageMatrix(paint, IMAGE.width, IMAGE.height, node);
	if (matrix === null) throw new Error('no image matrix');
	const toWorld = composeMatrices(node.transform, matrix);
	return transformPoint(toWorld, pixel.x, pixel.y);
}

describe('cropToRect', () => {
	it('keeps every image pixel where it was in the world', () => {
		const node = squareNode();
		const before = (pixel: { x: number; y: number }): { x: number; y: number } =>
			worldOfPixel(node, fill(), pixel);
		const props = cropToRect(node, IMAGE, { x: 20, y: 10, width: 60, height: 50 });
		if (props === null) throw new Error('expected a crop');
		const paint = paintOf(props);
		expect(paint.scaleMode).toBe('CROP');
		expect(props.width).toBe(60);
		expect(props.height).toBe(50);
		for (const pixel of [
			{ x: 100, y: 50 },
			{ x: 40, y: 10 },
			{ x: 190, y: 90 }
		]) {
			const after = worldOfPixel(props, paint, pixel);
			expect(after.x).toBeCloseTo(before(pixel).x);
			expect(after.y).toBeCloseTo(before(pixel).y);
		}
	});

	it('moves the node origin to the crop rectangle and leaves the blob reference alone', () => {
		const node = squareNode();
		const props = cropToRect(node, IMAGE, { x: 20, y: 10, width: 60, height: 50 });
		expect(props?.transform).toEqual([
			[1, 0, 30],
			[0, 1, 30]
		]);
		expect(paintOf(props ?? { fills: [] }).imageHash).toBe('h');
	});

	it('refuses an empty rectangle and nodes without an image', () => {
		expect(cropToRect(squareNode(), IMAGE, { x: 0, y: 0, width: 0, height: 10 })).toBeNull();
		const plain = createNode('RECTANGLE', { width: 10, height: 10 });
		expect(cropToRect(plain, IMAGE, { x: 0, y: 0, width: 5, height: 5 })).toBeNull();
	});
});

describe('clampToImage', () => {
	it('keeps the rectangle inside the image', () => {
		const node = squareNode();
		// the image spans x -50..150, y 0..100 in node space
		const rect = clampToImage(node, IMAGE, { x: -80, y: -10, width: 300, height: 200 });
		expect(rect).toEqual({ x: -50, y: 0, width: 200, height: 100 });
	});
});

describe('moveImage', () => {
	it('slides the image under the box and stops at the image edge', () => {
		const node = squareNode();
		const slid = moveImage(node, IMAGE, { x: 20, y: 0 });
		if (slid === null) throw new Error('expected a move');
		const pixel = { x: 100, y: 50 };
		const before = worldOfPixel(node, fill(), pixel);
		const after = worldOfPixel(node, paintOf(slid), pixel);
		expect(after.x - before.x).toBeCloseTo(20);
		const far = moveImage(node, IMAGE, { x: 500, y: 0 });
		const edge = worldOfPixel(node, paintOf(far ?? { fills: [] }), pixel);
		expect(edge.x - before.x).toBeCloseTo(50);
	});
});

describe('imageOutline', () => {
	it('gives the whole image in world space', () => {
		const node = squareNode();
		const outline = imageOutline(node, node.transform, IMAGE);
		expect(outline?.[0]).toEqual({ x: -40, y: 20 });
		expect(outline?.[2]).toEqual({ x: 160, y: 120 });
	});
});
