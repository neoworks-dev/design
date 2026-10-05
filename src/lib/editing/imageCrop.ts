// Cropping an image fill (docs/research/interactions.md section 1, Image). Pure.
//
// A crop never touches the stored bytes: the node's box shrinks (or the image slides under it)
// and the paint switches to `scaleMode: 'CROP'` with an `imageTransform` that keeps every image
// pixel where it was in the world. `imageTransform` maps the node's normalized box to the
// image's normalized pixels (the renderer inverts it, see `imageMatrix` in the paint shaders).

import {
	composeMatrices,
	invertMatrix,
	transformPoint,
	translationMatrix,
	type DocumentReader,
	type ImagePaint,
	type Matrix2x3,
	type Node,
	type Rect
} from '../document';
import { imageMatrix } from '../renderer/draw/paintShaders';
import type { PositionedNode } from './selectionOps';

export interface ImageSize {
	width: number;
	height: number;
}

/** The paint a crop edits: the first visible image fill, unrotated. */
export function croppableFill(node: Node): ImagePaint | undefined {
	if (!('fills' in node)) return undefined;
	for (const paint of node.fills) {
		if (paint.type !== 'IMAGE' || !paint.visible) continue;
		if (paint.rotation !== undefined && paint.rotation !== 0) return undefined;
		return paint;
	}
	return undefined;
}

/** Pixel size of the node's image from the asset record, when the file knows it. */
export function imageSizeOf(
	reader: { getEntity: DocumentReader['getEntity'] },
	node: Node
): ImageSize | undefined {
	const paint = croppableFill(node);
	if (paint === undefined) return undefined;
	const asset = reader.getEntity('asset', paint.imageHash);
	if (asset === undefined || asset.width === undefined || asset.height === undefined) {
		return undefined;
	}
	return { width: asset.width, height: asset.height };
}

export function hasImageFill(node: Node): boolean {
	return croppableFill(node) !== undefined;
}

function scaling(x: number, y: number): Matrix2x3 {
	return [
		[x, 0, 0],
		[0, y, 0]
	];
}

/** Image pixels to node space for the paint as drawn now. */
export function imageToNode(paint: ImagePaint, image: ImageSize, box: ImageSize): Matrix2x3 | null {
	return imageMatrix(paint, image.width, image.height, box);
}

/** Where the whole image lies in the node's local space (axis aligned, as the matrix has no skew). */
export function imageExtent(matrix: Matrix2x3, image: ImageSize): Rect {
	const [[a, , e], [, d, f]] = matrix;
	const width = a * image.width;
	const height = d * image.height;
	return { x: e, y: f, width, height };
}

/** The `imageTransform` that places `matrix` (image pixels to node space) in a box. */
function transformFor(matrix: Matrix2x3, image: ImageSize, box: ImageSize): Matrix2x3 | null {
	const normalized = composeMatrices(
		scaling(1 / box.width, 1 / box.height),
		composeMatrices(matrix, scaling(image.width, image.height))
	);
	return invertMatrix(normalized);
}

function croppedPaint(paint: ImagePaint, imageTransform: Matrix2x3): ImagePaint {
	return { ...paint, scaleMode: 'CROP', imageTransform };
}

function replaceFill(node: PositionedNode, original: ImagePaint, replacement: ImagePaint): unknown {
	if (!('fills' in node)) return [];
	return node.fills.map((paint) => {
		if (paint === original) return replacement;
		return paint;
	});
}

export interface CropProps {
	transform: Matrix2x3;
	width: number;
	height: number;
	fills: unknown;
}

/**
 * Crop `node` to `rect`, given in the node's local space and inside the image: the node's box
 * becomes the rectangle, the image stays put. Null when the node has no croppable image or the
 * rectangle is empty.
 */
export function cropToRect(node: PositionedNode, image: ImageSize, rect: Rect): CropProps | null {
	const paint = croppableFill(node);
	if (paint === undefined || rect.width <= 0 || rect.height <= 0) return null;
	const matrix = imageToNode(paint, image, node);
	if (matrix === null) return null;
	const shifted = composeMatrices(translationMatrix(-rect.x, -rect.y), matrix);
	const imageTransform = transformFor(shifted, image, rect);
	if (imageTransform === null) return null;
	return {
		transform: composeMatrices(node.transform, translationMatrix(rect.x, rect.y)),
		width: rect.width,
		height: rect.height,
		fills: replaceFill(node, paint, croppedPaint(paint, imageTransform))
	};
}

/** `rect` pulled inside the image, so a crop never reveals empty space. */
export function clampToImage(node: PositionedNode, image: ImageSize, rect: Rect): Rect {
	const paint = croppableFill(node);
	if (paint === undefined) return rect;
	const matrix = imageToNode(paint, image, node);
	if (matrix === null) return rect;
	const extent = imageExtent(matrix, image);
	const left = Math.max(rect.x, extent.x);
	const top = Math.max(rect.y, extent.y);
	const right = Math.min(rect.x + rect.width, extent.x + extent.width);
	const bottom = Math.min(rect.y + rect.height, extent.y + extent.height);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Slide the image under the node's box by `delta` (node space), staying under the whole box. */
export function moveImage(
	node: PositionedNode,
	image: ImageSize,
	delta: { x: number; y: number }
): Pick<CropProps, 'fills'> | null {
	const paint = croppableFill(node);
	if (paint === undefined) return null;
	const matrix = imageToNode(paint, image, node);
	if (matrix === null) return null;
	const extent = imageExtent(matrix, image);
	const dx = clamp(delta.x, node.width - (extent.x + extent.width), -extent.x);
	const dy = clamp(delta.y, node.height - (extent.y + extent.height), -extent.y);
	const moved = composeMatrices(translationMatrix(dx, dy), matrix);
	const imageTransform = transformFor(moved, image, node);
	if (imageTransform === null) return null;
	return { fills: replaceFill(node, paint, croppedPaint(paint, imageTransform)) };
}

function clamp(value: number, low: number, high: number): number {
	if (low > high) return value > 0 ? high : low;
	return Math.min(high, Math.max(low, value));
}

/** The four corners of the whole image in world space, for the crop mode's ghost outline. */
export function imageOutline(
	node: PositionedNode,
	absolute: Matrix2x3,
	image: ImageSize
): { x: number; y: number }[] | null {
	const paint = croppableFill(node);
	if (paint === undefined) return null;
	const matrix = imageToNode(paint, image, node);
	if (matrix === null) return null;
	const toWorld = composeMatrices(absolute, matrix);
	return [
		transformPoint(toWorld, 0, 0),
		transformPoint(toWorld, image.width, 0),
		transformPoint(toWorld, image.width, image.height),
		transformPoint(toWorld, 0, image.height)
	];
}
