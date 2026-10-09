// Dropping image files onto the canvas. Default: a leaf shape under the pointer takes the image as
// its fill (replacing its fills); Alt, or anything else under the pointer (a frame, empty canvas),
// places new image rectangles in a row from the drop point instead. [K]: Figma's own modifier
// for this is not verified.

import type { Context } from '@neoworks/extension-system';
import {
	fillShapeWithImage,
	placeImages,
	prepareImage,
	type PreparedImage,
	type Rasterize
} from '../../lib/editing/placeImages';
import { applyEdit } from '../../lib/editing/contribute';
import { planSvgImport } from '../../lib/editing/planSvgImport';
import type { Point } from '../../lib/tools/protocol';

const FILLABLE_TYPES: readonly string[] = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR'];
const HIT_TOLERANCE_PIXELS = 3;

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;

export function isImageFile(file: File): boolean {
	return file.type.startsWith('image/') || IMAGE_NAME.test(file.name);
}

export function hasFiles(event: DragEvent): boolean {
	const types = event.dataTransfer?.types;
	if (types === undefined) return false;
	return Array.from(types).includes('Files');
}

/** Read and store every image among `files`; files that fail are logged and skipped. */
export async function prepareFiles(
	ctx: Context,
	files: readonly File[],
	rasterize?: Rasterize
): Promise<PreparedImage[]> {
	const prepared: PreparedImage[] = [];
	for (const file of files) {
		if (!isImageFile(file)) continue;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			prepared.push(await prepareImage(ctx, file.name, bytes, rasterize));
		} catch (error) {
			ctx.logger.error(`could not place ${file.name}`, error);
		}
	}
	return prepared;
}

function isSvgFile(file: File): boolean {
	return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

const SVG_GAP = 24;

/**
 * Dropped `.svg` files become vector layers when an importer (the `svg-import` plugin) is loaded,
 * one undo step per file, side by side from the drop point. Returns the files that were not
 * imported that way, for the image path.
 */
export async function importDroppedSvgs(
	ctx: Context,
	files: readonly File[],
	world: Point
): Promise<File[]> {
	const remaining: File[] = [];
	let cursor = world;
	for (const file of files) {
		if (!isSvgFile(file)) {
			remaining.push(file);
			continue;
		}
		const plan = planSvgImport(
			ctx,
			await file.text(),
			{
				mode: 'drop',
				documentId: ctx.document.documentId,
				currentPageId: ctx.document.currentPageId,
				selection: [],
				viewport: ctx.viewport.visibleRect(),
				cursor
			},
			file.name.replace(/\.svg$/i, '')
		);
		if (plan === null || !applyEdit(ctx, plan.changes, 'Import SVG')) {
			remaining.push(file);
			continue;
		}
		ctx.selection.select(plan.newRootIds);
		const [root] = plan.newRootIds;
		cursor = { x: cursor.x + ctx.document.absoluteBounds(root).width + SVG_GAP, y: cursor.y };
	}
	return remaining;
}

function fillableShapeAt(ctx: Context, world: Point): string | undefined {
	const hitId = ctx.hitTest.deepest({
		point: world,
		tolerance: HIT_TOLERANCE_PIXELS / ctx.viewport.zoom
	});
	if (hitId === undefined) return undefined;
	if (!FILLABLE_TYPES.includes(ctx.document.require(hitId).type)) return undefined;
	return hitId;
}

/** Apply a drop of prepared images at a world point. */
export function dropImages(
	ctx: Context,
	images: readonly PreparedImage[],
	world: Point,
	replaceModifier: { altKey: boolean }
): void {
	if (images.length === 0) return;
	const shapeId = fillableShapeAt(ctx, world);
	if (shapeId !== undefined && !replaceModifier.altKey) {
		if (fillShapeWithImage(ctx, shapeId, images[0])) {
			ctx.selection.select([shapeId]);
			return;
		}
	}
	placeImages(ctx, images, { at: world });
}

/**
 * Listen for file drops on the canvas element. Returns the inverse. `world` is computed from the
 * event position relative to the element.
 */
export function watchDrops(ctx: Context, element: HTMLElement, rasterize?: Rasterize): () => void {
	const allow = (event: DragEvent): void => {
		if (!hasFiles(event)) return;
		event.preventDefault();
	};
	const drop = (event: DragEvent): void => {
		if (!hasFiles(event) || event.dataTransfer === null) return;
		event.preventDefault();
		const bounds = element.getBoundingClientRect();
		const world = ctx.viewport.screenToWorld({
			x: event.clientX - bounds.left,
			y: event.clientY - bounds.top
		});
		const files = Array.from(event.dataTransfer.files);
		const altKey = event.altKey;
		importDroppedSvgs(ctx, files, world)
			.then((rest) => prepareFiles(ctx, rest, rasterize))
			.then((images) => dropImages(ctx, images, world, { altKey }))
			.catch((error: unknown) => ctx.logger.error('image drop failed', error));
	};
	element.addEventListener('dragover', allow);
	element.addEventListener('drop', drop);
	return () => {
		element.removeEventListener('dragover', allow);
		element.removeEventListener('drop', drop);
	};
}
