// Headless export: draws one node, or the page area under it, to pixels on an offscreen raster
// surface and encodes them. Pure library code over a SceneSource and a geometry provider, so it
// runs in vitest/Node without a display, in the app, and later inside a worker.
//
// Bounds follow Figma's export settings: the area is the node's render bounds (strokes and
// effects included) unless `useAbsoluteBounds`, which exports exactly the node's box.
// `contentsOnly` (default) draws only the node and its subtree; without it everything on the page
// that overlaps the area is drawn too (a "screenshot of the area").

import type { CanvasKit } from 'canvaskit-wasm';
import type { Matrix2x3, NodeId, Rect, RGBA } from '../document/types';
import { createDrawContext } from './draw/context';
import type { DrawHooks } from './draw/hooks';
import { toCanvasKitMatrix } from './draw/matrix';
import { drawNodeSubtree, drawPageContents } from './draw/scene';
import type { SkiaTracker } from './ownership';
import type { SceneSource } from './sceneSource';
import { RenderSurface } from './surface';

export type ExportFormat = 'PNG' | 'JPG' | 'WEBP';

export interface ExportOptions {
	/** Pixels per document unit; 1 by default. */
	scale?: number;
	format?: ExportFormat;
	/** 0-100, JPG and WEBP only. */
	quality?: number;
	/** Drawn behind the artwork; transparent by default (JPG has no alpha: white then). */
	background?: RGBA;
	/** Only the node and its subtree (default true). */
	contentsOnly?: boolean;
	/** Export the node's own box instead of its render bounds (default false). */
	useAbsoluteBounds?: boolean;
}

export interface ExportGeometry {
	absoluteTransform(id: NodeId): Matrix2x3;
	/** The node's own rectangle in page space. */
	absoluteBounds(id: NodeId): Rect;
	/** The box grown by outside strokes and effects. */
	renderBounds(id: NodeId): Rect;
}

export interface ExportEnvironment {
	canvasKit: CanvasKit;
	tracker: SkiaTracker;
	hooks: DrawHooks;
	source: SceneSource;
	geometry: ExportGeometry;
}

export interface ExportedImage {
	bytes: Uint8Array;
	width: number;
	height: number;
	format: ExportFormat;
	mimeType: string;
}

/** Largest side of one export, in pixels. A bigger area would need tiles (not built yet). */
export const MAX_EXPORT_SIDE = 16384;

const MIME_TYPES: Record<ExportFormat, string> = {
	PNG: 'image/png',
	JPG: 'image/jpeg',
	WEBP: 'image/webp'
};

export class ExportError extends Error {}

export async function exportNode(
	environment: ExportEnvironment,
	id: NodeId,
	options: ExportOptions = {}
): Promise<ExportedImage> {
	const settings = resolveOptions(options);
	const node = environment.source.getNode(id);
	if (!node || node.type === 'PAGE') throw new ExportError(`cannot export ${id}: not a node`);
	const area = exportArea(environment.geometry, id, settings.useAbsoluteBounds);
	const width = pixelSize(area.width, settings.scale);
	const height = pixelSize(area.height, settings.scale);
	if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
		throw new ExportError(`export of ${width}x${height} exceeds ${MAX_EXPORT_SIDE} pixels a side`);
	}
	const { canvasKit, tracker } = environment;
	const surface = RenderSurface.offscreen(canvasKit, tracker, width, height);
	try {
		drawExport(environment, surface, id, area, settings);
		return await encodeExport(surface, width, height, settings);
	} finally {
		surface.dispose();
	}
}

/** Whole pixels covering `size * scale`; float noise (100.00000000000001) must not add a pixel. */
export function pixelSize(size: number, scale: number): number {
	return Math.max(1, Math.ceil(size * scale - 1e-6));
}

interface ResolvedOptions {
	scale: number;
	format: ExportFormat;
	quality: number;
	background: RGBA | null;
	contentsOnly: boolean;
	useAbsoluteBounds: boolean;
}

function resolveOptions(options: ExportOptions): ResolvedOptions {
	const scale = options.scale === undefined ? 1 : options.scale;
	if (!(scale > 0)) throw new ExportError(`invalid export scale ${scale}`);
	const format = options.format === undefined ? 'PNG' : options.format;
	return {
		scale,
		format,
		quality: options.quality === undefined ? 92 : options.quality,
		background: backgroundFor(format, options.background),
		contentsOnly: options.contentsOnly !== false,
		useAbsoluteBounds: options.useAbsoluteBounds === true
	};
}

function backgroundFor(format: ExportFormat, background: RGBA | undefined): RGBA | null {
	if (background !== undefined) return background;
	if (format === 'JPG') return { r: 1, g: 1, b: 1, a: 1 };
	return null;
}

/** The area an export of `id` covers, in page space. */
export function exportArea(geometry: ExportGeometry, id: NodeId, useAbsoluteBounds: boolean): Rect {
	if (useAbsoluteBounds) return geometry.absoluteBounds(id);
	return geometry.renderBounds(id);
}

function drawExport(
	environment: ExportEnvironment,
	surface: RenderSurface,
	id: NodeId,
	area: Rect,
	settings: ResolvedOptions
): void {
	const { canvasKit, tracker, hooks, source, geometry } = environment;
	const scope = tracker.scope();
	try {
		surface.frame((canvas) => {
			clearBackground(canvasKit, canvas, settings.background);
			canvas.scale(settings.scale, settings.scale);
			canvas.translate(-area.x, -area.y);
			const view = {
				x: -area.x * settings.scale,
				y: -area.y * settings.scale,
				scale: settings.scale
			};
			const size = { width: area.width, height: area.height };
			const context = createDrawContext(
				canvasKit,
				canvas,
				scope,
				{ source, view, size, devicePixelRatio: 1 },
				hooks
			);
			const node = source.getNode(id);
			if (!node) return;
			if (!settings.contentsOnly) {
				drawPageContents(context, pageOf(source, id));
				return;
			}
			// the node draws its own transform; its ancestors' transforms are applied here, and their
			// clipping, opacity and effects are left out like in Figma's export
			if (node.parentId !== null) {
				canvas.concat(toCanvasKitMatrix(geometry.absoluteTransform(node.parentId)));
			}
			drawNodeSubtree(context, id);
		});
	} finally {
		scope.dispose();
	}
}

function clearBackground(
	canvasKit: CanvasKit,
	canvas: { clear(color: Float32Array): void },
	background: RGBA | null
): void {
	if (background === null) {
		canvas.clear(canvasKit.TRANSPARENT);
		return;
	}
	canvas.clear(canvasKit.Color4f(background.r, background.g, background.b, background.a));
}

function pageOf(source: SceneSource, id: NodeId): NodeId {
	let current = source.getNode(id);
	while (current && current.type !== 'PAGE') {
		if (current.parentId === null) break;
		current = source.getNode(current.parentId);
	}
	if (!current) throw new ExportError(`node ${id} is not on a page`);
	return current.id;
}

async function encodeExport(
	surface: RenderSurface,
	width: number,
	height: number,
	settings: ResolvedOptions
): Promise<ExportedImage> {
	const bytes = await encodeBytes(surface, width, height, settings);
	return { bytes, width, height, format: settings.format, mimeType: MIME_TYPES[settings.format] };
}

/** Skia's encoder where the build has it (PNG always); the browser's otherwise (JPG, WEBP). */
async function encodeBytes(
	surface: RenderSurface,
	width: number,
	height: number,
	settings: ResolvedOptions
): Promise<Uint8Array> {
	const skiaFormat = settings.format === 'JPG' ? 'JPEG' : settings.format;
	const encoded = surface.encode(skiaFormat, settings.quality);
	if (encoded !== null && encoded !== undefined) return encoded;
	if (typeof OffscreenCanvas === 'undefined') {
		throw new ExportError(`this CanvasKit build cannot encode ${settings.format} here`);
	}
	const pixels = surface.readPixels({ x: 0, y: 0, width, height });
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (context === null) throw new ExportError('no 2d context to encode with');
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
	const blob = await canvas.convertToBlob({
		type: MIME_TYPES[settings.format],
		quality: settings.quality / 100
	});
	return new Uint8Array(await blob.arrayBuffer());
}
