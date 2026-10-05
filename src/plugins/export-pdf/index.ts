import type { Context } from '@neoworks/extension-system';
import { serializePdf } from '../../lib/export/pdf';
import type {
	ExportFormatProvider,
	ExportRenderRequest,
	RenderedExport
} from '../../lib/export/types';

// PDF export (#128), vector output written from the scene by lib/export/pdf.ts. A custom
// CanvasKit build with SkPDF could not be made offline (no Skia sources, no Emscripten), so this
// is the fallback; swapping the provider for an SkPDF-backed one needs no change elsewhere.
// One page per exported node. Slices (no content of their own) export blank pages for now.
export default {
	name: 'export-pdf',
	inject: ['export', 'headlessRenderer', 'document'],
	apply(ctx: Context): void {
		const provider: ExportFormatProvider = {
			id: 'PDF',
			label: 'PDF',
			extension: 'pdf',
			mimeType: 'application/pdf',
			render: (request) => Promise.resolve(renderPdf(ctx, request))
		};
		ctx.effect(() => ctx.export.formats.register(provider), 'export format PDF');
	}
};

function renderPdf(ctx: Context, request: ExportRenderRequest): RenderedExport {
	const { source, geometry } = ctx.headlessRenderer.scene();
	const result = serializePdf(
		source,
		geometry,
		[{ nodeId: request.nodeId, area: request.area }],
		request.scale
	);
	return {
		bytes: result.bytes,
		width: Math.ceil(request.area.width * request.scale),
		height: Math.ceil(request.area.height * request.scale)
	};
}
