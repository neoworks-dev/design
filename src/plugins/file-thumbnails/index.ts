import type { Context } from '@neoworks/extension-system';
import { pickThumbnailNode, thumbnailScale } from '../../lib/home/thumbnail';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/** Draw the first design of the current page small, and store it in the open file. */
async function storeThumbnail(ctx: Context): Promise<void> {
	const pageId = ctx.document.currentPageId;
	const nodes = ctx.document.children(pageId).map((id) => {
		const bounds = ctx.document.absoluteBounds(id);
		return { id, type: ctx.document.require(id).type, width: bounds.width, height: bounds.height };
	});
	const nodeId = pickThumbnailNode({ topLevel: () => nodes });
	if (nodeId === undefined) return;
	const bounds = ctx.document.absoluteBounds(nodeId);
	const pathBefore = ctx.fileSession.info?.path;
	const image = await ctx.headlessRenderer.exportNode(nodeId, {
		scale: thumbnailScale(bounds.width, bounds.height),
		format: 'PNG',
		background: WHITE,
		useAbsoluteBounds: true,
		contentsOnly: false
	});
	// The file changed while the image was drawn: it would be stored in the wrong document.
	if (ctx.fileSession.info?.path !== pathBefore) return;
	await ctx.desktop.filesSetThumbnail({
		mime: image.mimeType,
		width: image.width,
		height: image.height,
		bytes: image.bytes
	});
}

const THUMBNAIL_DELAY_MS = 2000;

// The preview the home screen shows for a file: drawn with the headless renderer a moment after
// autosave went idle (so a burst of edits draws once) and stored in the file's `thumbnails` table
// by main.
export default {
	name: 'file-thumbnails',
	inject: ['headlessRenderer', 'document', 'fileSession', 'desktop'],
	apply(ctx: Context, config?: { delayMs?: number }): void {
		const delayMs = config?.delayMs ?? THUMBNAIL_DELAY_MS;
		ctx.effect(() => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const dispose = ctx.on('file/saved', () => {
				clearTimeout(timer);
				timer = setTimeout(() => {
					storeThumbnail(ctx).catch((error: unknown) => ctx.logger.warn('thumbnail', error));
				}, delayMs);
			});
			return () => {
				clearTimeout(timer);
				dispose();
			};
		}, 'file-thumbnails/after-autosave');
	}
};
