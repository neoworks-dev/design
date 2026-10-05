// Placing images: the shared core of the image tool, drag and drop and the file picker (paste has
// its own path in the clipboard plugin and uses the same rectangle shape). Bytes go through
// `ctx.blobs.put`; the returned asset changes are applied in the same `document.apply` as the
// nodes or paint that refer to the hash, so one placement is one undo step.

import type { Context } from '@neoworks/extension-system';
import { looksLikeSvg, rasterizeSvg } from '../assets/svgRaster';
import {
	createNode,
	identityMatrix,
	keyBetween,
	planSetProps,
	type Change,
	type ImagePaint,
	type Node,
	type NodeId,
	type Rect
} from '../document';
import { boxPlacement, findContainer } from '../tools/creation';
import type { Point } from '../tools/protocol';
import { nestingSource } from './creationTool.svelte';
import { applyEdit } from './contribute';
import { fittedSize } from './paste';
import { isPositioned } from './selectionOps';

/** Space between images placed in a row (world units). */
export const ROW_GAP = 24;

export type Rasterize = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface PreparedImage {
	/** Layer name: the file name without its extension. */
	name: string;
	hash: string;
	width: number;
	height: number;
	/** Adds the asset record to the document; empty when it is already there. */
	assetChanges: Change[];
}

function layerName(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	if (dot <= 0) return fileName;
	return fileName.slice(0, dot);
}

/** Store the bytes of an image file (an SVG is rasterised first) and describe the result. */
export async function prepareImage(
	ctx: Context,
	fileName: string,
	bytes: Uint8Array,
	rasterize: Rasterize = rasterizeSvg
): Promise<PreparedImage> {
	let pixels = bytes;
	if (looksLikeSvg(bytes)) pixels = await rasterize(bytes);
	const stored = await ctx.blobs.put(pixels);
	return {
		name: layerName(fileName),
		hash: stored.hash,
		width: stored.info.width,
		height: stored.info.height,
		assetChanges: stored.changes
	};
}

export function imageFill(hash: string): ImagePaint {
	return {
		type: 'IMAGE',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		imageHash: hash,
		scaleMode: 'FILL'
	};
}

function viewportRect(ctx: Context): Rect | null {
	const size = ctx.viewport.size;
	if (size.width <= 0 || size.height <= 0) return null;
	return ctx.viewport.visibleRect();
}

function uniqueAssetChanges(images: readonly PreparedImage[]): Change[] {
	const seen = new Set<string>();
	const changes: Change[] = [];
	for (const image of images) {
		if (seen.has(image.hash)) continue;
		seen.add(image.hash);
		changes.push(...image.assetChanges);
	}
	return changes;
}

export interface PlacementRequest {
	/** Top left of the first image, in world space. */
	at: Point;
	/** Size of the first image (a dragged box); natural size capped to the viewport otherwise. */
	firstSize?: { width: number; height: number };
}

export interface PlacementPlan {
	changes: Change[];
	ids: NodeId[];
}

/** Rectangles with image fills in a row, nested into the frame under `request.at`. */
export function planPlacement(
	ctx: Context,
	images: readonly PreparedImage[],
	request: PlacementRequest
): PlacementPlan {
	const container = containerAt(ctx, request.at);
	const parentAbsolute = parentTransform(ctx, container);
	const viewport = viewportRect(ctx);
	const changes = uniqueAssetChanges(images);
	const ids: NodeId[] = [];
	let previousIndex = lastIndexIn(ctx, container);
	let x = request.at.x;
	images.forEach((image, position) => {
		let size = fittedSize(image, viewport);
		if (position === 0 && request.firstSize !== undefined) size = request.firstSize;
		const placement = boxPlacement({ x, y: request.at.y, ...size }, parentAbsolute);
		previousIndex = keyBetween(previousIndex, null);
		const node = createNode('RECTANGLE', {
			name: image.name,
			...placement,
			parentId: container,
			index: previousIndex,
			fills: [imageFill(image.hash)]
		});
		changes.push(...ctx.document.insertNode(node));
		ids.push(node.id);
		x += size.width + ROW_GAP;
	});
	return { changes, ids };
}

function containerAt(ctx: Context, point: Point): NodeId {
	return findContainer(nestingSource(ctx), ctx.document.currentPageId, point);
}

function parentTransform(ctx: Context, containerId: NodeId): ReturnType<typeof identityMatrix> {
	if (ctx.document.require(containerId).type === 'PAGE') return identityMatrix();
	return ctx.document.absoluteTransform(containerId);
}

function lastIndexIn(ctx: Context, containerId: NodeId): string | null {
	const lastSibling = ctx.document.childNodes(containerId).at(-1);
	if (lastSibling === undefined) return null;
	return lastSibling.index;
}

/** Place images and select the new nodes, as one undo step. Returns the new ids. */
export function placeImages(
	ctx: Context,
	images: readonly PreparedImage[],
	request: PlacementRequest
): NodeId[] {
	const plan = planPlacement(ctx, images, request);
	if (!applyEdit(ctx, plan.changes, images.length === 1 ? 'Place image' : 'Place images'))
		return [];
	ctx.selection.select(plan.ids);
	return plan.ids;
}

function canTakeFill(node: Node): boolean {
	if (node.type === 'PAGE' || node.type === 'TEXT' || node.type === 'SLICE') return false;
	return 'fills' in node;
}

/**
 * Make an image the fill of an existing shape (dropping onto it). The image replaces the
 * shape's fills; false when the shape cannot take a fill.
 */
export function fillShapeWithImage(ctx: Context, shapeId: NodeId, image: PreparedImage): boolean {
	const node = ctx.document.require(shapeId);
	if (!canTakeFill(node) || !isPositioned(node) || node.locked) return false;
	const changes = [
		...image.assetChanges,
		...planSetProps(ctx.document.reader, shapeId, { fills: [imageFill(image.hash)] })
	];
	return applyEdit(ctx, changes, 'Replace fill with image');
}
