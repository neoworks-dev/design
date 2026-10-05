import type { Context } from '@neoworks/extension-system';
import type {
	ExportFormatProvider,
	ExportRenderRequest,
	RenderedExport
} from '../../lib/export/types';

type RasterFormat = 'PNG' | 'JPG' | 'WEBP';

const RASTER_FORMATS: Array<{
	id: RasterFormat;
	label: string;
	extension: string;
	mimeType: string;
}> = [
	{ id: 'PNG', label: 'PNG', extension: 'png', mimeType: 'image/png' },
	{ id: 'JPG', label: 'JPG', extension: 'jpg', mimeType: 'image/jpeg' },
	{ id: 'WEBP', label: 'WEBP', extension: 'webp', mimeType: 'image/webp' }
];

// PNG (with alpha), JPG (flattened on white unless a background is given) and WEBP (#126), drawn
// by the headless renderer with the same draw hooks as the screen. Colour profile: sRGB only.
// A slice has no content of its own, so it exports what lies under it (contentsOnly off).
export default {
	name: 'export-raster',
	inject: ['export', 'headlessRenderer', 'document'],
	apply(ctx: Context): void {
		for (const format of RASTER_FORMATS) {
			const provider: ExportFormatProvider = {
				...format,
				render: (request) => renderRaster(ctx, format.id, request)
			};
			ctx.effect(() => ctx.export.formats.register(provider), `export format ${format.id}`);
		}
	}
};

async function renderRaster(
	ctx: Context,
	format: RasterFormat,
	request: ExportRenderRequest
): Promise<RenderedExport> {
	const node = ctx.document.require(request.nodeId);
	const { options } = request;
	let contentsOnly = options.contentsOnly !== false;
	if (node.type === 'SLICE') contentsOnly = false;
	const image = await ctx.headlessRenderer.exportNode(request.nodeId, {
		scale: request.scale,
		format,
		quality: options.quality,
		background: options.background,
		contentsOnly,
		useAbsoluteBounds: options.useAbsoluteBounds === true
	});
	return { bytes: image.bytes, width: image.width, height: image.height };
}
