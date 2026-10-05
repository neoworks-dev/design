import type { Context } from '@neoworks/extension-system';
import type { SceneNode } from '../../lib/document';
import { serializeSvg } from '../../lib/export/svg';
import type {
	ExportFormatProvider,
	ExportRenderRequest,
	RenderedExport
} from '../../lib/export/types';
import { booleanResultPath } from '../../lib/renderer/booleanOps';

// SVG export (#127): the scene serialised by our own serializer (lib/export/svg.ts); the stock
// canvaskit-wasm build has no SVG canvas. Slices export what lies under them.
export default {
	name: 'export-svg',
	inject: ['export', 'headlessRenderer', 'document'],
	apply(ctx: Context): void {
		const provider: ExportFormatProvider = {
			id: 'SVG',
			label: 'SVG',
			extension: 'svg',
			mimeType: 'image/svg+xml',
			render: (request) => Promise.resolve(renderSvg(ctx, request))
		};
		ctx.effect(() => ctx.export.formats.register(provider), 'export format SVG');
	}
};

function renderSvg(ctx: Context, request: ExportRenderRequest): RenderedExport {
	const { source, geometry, canvasKit } = ctx.headlessRenderer.scene();
	const node = ctx.document.require(request.nodeId);
	const { options } = request;
	let contentsOnly = options.contentsOnly !== false;
	if (node.type === 'SLICE') contentsOnly = false;
	const result = serializeSvg(source, geometry, request.nodeId, {
		area: request.area,
		scale: request.scale,
		contentsOnly,
		background: options.background,
		booleanPathData: (booleanNode) => booleanPathData(canvasKit, source, booleanNode)
	});
	return {
		bytes: new TextEncoder().encode(result.svg),
		width: result.width,
		height: result.height
	};
}

function booleanPathData(
	canvasKit: Parameters<typeof booleanResultPath>[0],
	source: Parameters<typeof booleanResultPath>[1],
	node: SceneNode
): string | null {
	if (node.type !== 'BOOLEAN_OPERATION') return null;
	const owned: Array<{ delete(): void }> = [];
	try {
		const path = booleanResultPath(canvasKit, source, node, (object) => {
			owned.push(object);
			return object;
		});
		if (path === null) return null;
		return path.toSVGString();
	} finally {
		for (const object of owned) object.delete();
	}
}
