// The `headlessRenderer` service: pixels of a node without the visible canvas, for export,
// thumbnails, AI screenshots and tests (#44). It draws with the same hooks as the screen
// (`ctx.renderer.drawHooks`), so shadows, gradients and images look identical.
//
//   const { bytes, mimeType } = await ctx.headlessRenderer.exportNode(id, { scale: 2 });
//
// Seam for the clipboard: `await navigator.clipboard.write([new ClipboardItem({ [mimeType]:
// new Blob([bytes], { type: mimeType }) })])` with the PNG bytes, or the desktop bridge's image
// write once it exists.

import { Service, type Context } from '@neoworks/extension-system';
import type { NodeId, Rect } from '../document';
import type { SceneSource } from '../renderer/sceneSource';
import {
	exportArea,
	exportNode,
	type ExportGeometry,
	type ExportedImage,
	type ExportEnvironment,
	type ExportOptions
} from '../renderer/exportNode';

declare module '@neoworks/extension-system' {
	interface Context {
		headlessRenderer: HeadlessRendererService;
	}
}

export class HeadlessRendererService extends Service {
	constructor(
		ctx: Context,
		private readonly environment: () => ExportEnvironment
	) {
		super(ctx, 'headlessRenderer');
	}

	/** Renders node `id` (and its subtree) to encoded bytes. Throws `ExportError` when it cannot. */
	exportNode(id: NodeId, options: ExportOptions = {}): Promise<ExportedImage> {
		return exportNode(this.environment(), id, options);
	}

	/** The area an export of `id` covers in page space: render bounds, or the box itself. */
	exportArea(id: NodeId, useAbsoluteBounds = false): Rect {
		return exportArea(this.environment().geometry, id, useAbsoluteBounds);
	}

	/** The scene (variable-resolved nodes) and geometry vector exporters serialise from. */
	scene(): { source: SceneSource; geometry: ExportGeometry } {
		const { source, geometry } = this.environment();
		return { source, geometry };
	}
}
