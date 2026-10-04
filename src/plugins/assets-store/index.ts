import type { Context } from '@neoworks/extension-system';
import { BlobsService } from '../../lib/services/blobs';

declare module '@neoworks/extension-system' {
	interface Context {
		blobs: BlobsService;
	}
}

// assets-store: provides `blobs`, sha-256 keyed bytes for images and embedded fonts, stored in
// the open file by main. Embedded fonts are restored through the `fonts` service whenever a file
// is attached. Paste, drag-drop and the image tool call `ctx.blobs.put(bytes)` and apply the
// returned `changes` together with their paint.
export default {
	name: 'assets-store',
	inject: ['desktop', 'document', 'fonts'],
	apply(ctx: Context): void {
		const blobs = new BlobsService(ctx, ctx.desktop, ctx.document, ctx.fonts);

		ctx.on('file/attached', () => {
			blobs.forgetCache();
			blobs.restoreEmbeddedFonts().catch((error: unknown) => ctx.logger.error(error));
		});
		ctx.effect(() => () => blobs.dispose(), 'assets-store:caches');
	}
};
