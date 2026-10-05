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
		prepareFiles(ctx, files, rasterize)
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
