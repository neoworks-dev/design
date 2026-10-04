import type { Context } from '@neoworks/extension-system';
import { HeadlessRendererService } from '../../lib/services/headlessRenderer';
import { DocumentSceneSource } from '../../lib/services/documentSceneSource';

// Provides `headlessRenderer`: exports of nodes drawn on an offscreen raster surface with the
// renderer's own draw hooks. Each export builds its surface, draws, encodes and deletes it in one
// synchronous call, so nothing is held between calls and there is no worker to terminate; a
// worker or utility process can take this over later behind the same service (the drawing code in
// lib/renderer/exportNode.ts only needs a SceneSource and a CanvasKit).
export default {
	name: 'headless-renderer',
	inject: ['renderer', 'canvaskit', 'document', 'variables', 'spatial'],
	apply(ctx: Context): void {
		new HeadlessRendererService(ctx, () => ({
			canvasKit: ctx.canvaskit.kit,
			tracker: ctx.canvaskit.tracker,
			hooks: ctx.renderer.drawHooks,
			source: new DocumentSceneSource(ctx.document, ctx.variables),
			geometry: ctx.spatial.sceneIndex
		}));
	}
};
