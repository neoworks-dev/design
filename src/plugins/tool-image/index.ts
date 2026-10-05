import type { Context } from '@neoworks/extension-system';
import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
import CropIcon from 'phosphor-svelte/lib/CropIcon';
import { contributeCommand } from '../../lib/editing/contribute';
import { CreationPreview } from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';
import { prepareImage, type PreparedImage } from '../../lib/editing/placeImages';
import { CropSession } from '../../lib/selecting/cropSession';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import TransformHandles from '../../lib/selecting/TransformHandles.svelte';
import CropOverlay from './CropOverlay.svelte';
import { createCropTool, CROP_TOOL_ID, CropState, enterCropMode } from './cropTool.svelte';
import { watchDrops } from './dropImages';
import { createImageTool, IMAGE_TOOL_ID, PendingImages } from './imageTool.svelte';

async function pickImages(ctx: Context): Promise<PreparedImage[] | null> {
	const picked = await ctx.desktop.openImagesDialog();
	if (picked === null) return null;
	const prepared: PreparedImage[] = [];
	for (const file of picked) {
		try {
			prepared.push(await prepareImage(ctx, file.name, file.bytes));
		} catch (error) {
			ctx.logger.error(`could not place ${file.name}`, error);
		}
	}
	return prepared;
}

// Image placement (docs/research/interactions.md section 1, Image/video):
//   Ctrl+Shift+K   the native file picker; the chosen images wait on the image tool, a click
//                  places them in a row at natural size (capped to the viewport), a drag sizes
//                  the first one to the dragged box
//   drop           image files dropped on the canvas fill the leaf shape under the pointer, or
//                  (Alt, or no such shape) are placed as new image rectangles
//   Alt+dbl-click  an image enters the crop mode: handles crop the box, dragging slides the image
//   Ctrl+resize    crops an image with the ordinary transform handles (in `transform-handles`)
// Pasting images lives in the `clipboard` plugin and builds the same rectangle. The bytes go
// through `ctx.blobs.put`; its asset changes are applied together with the nodes or paint that
// use the hash, so every placement or crop is one undo step.
export default {
	name: 'tool-image',
	inject: [
		'tools',
		'document',
		'selection',
		'history',
		'viewport',
		'regions',
		'commands',
		'keymap',
		'blobs',
		'desktop',
		'renderer',
		'hitTest',
		'snapping'
	],
	apply(ctx: Context): void {
		const pending = new PendingImages();
		const preview = new CreationPreview();
		const cropState = new CropState();
		const cropFeedback = new ResizeFeedbackState();
		const cropGesture = new ResizeGesture(ctx, cropFeedback, {
			label: 'Crop image',
			createSession: (reader, ids) => new CropSession(reader, ids)
		});

		ctx.effect(
			() =>
				ctx.tools.register({
					id: IMAGE_TOOL_ID,
					title: 'Image',
					icon: ImageIcon,
					group: 'create',
					toolbarGroup: 'shapes',
					order: 11.6,
					cursor: 'crosshair',
					toolbar: false,
					overlay: { component: CreationPreviewOverlay, props: { preview } },
					...createImageTool(ctx, pending, preview)
				}),
			'image tool'
		);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: CROP_TOOL_ID,
					title: 'Crop image',
					icon: CropIcon,
					group: 'create',
					order: 10.4,
					cursor: 'default',
					toolbar: false,
					overlay: { component: CropOverlay, props: { state: cropState } },
					...createCropTool(ctx, cropState)
				}),
			'image crop tool'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'tool-image/crop-handles',
					region: 'canvas-overlay',
					component: TransformHandles,
					props: { feedback: cropFeedback, gesture: cropGesture, toolId: CROP_TOOL_ID }
				}),
			'image crop handles overlay'
		);

		ctx.effect(() => watchGestureKeys([cropGesture]), 'image crop key handling');

		contributeCommand(ctx, {
			id: 'image.place',
			title: 'Place image...',
			keys: ['Mod+Shift+K'],
			run: () => {
				pickImages(ctx)
					.then((images) => {
						if (images === null || images.length === 0) return;
						pending.images = images;
						ctx.tools.activate(IMAGE_TOOL_ID);
					})
					.catch((error: unknown) => ctx.logger.error('place image failed', error));
			}
		});

		ctx.on('canvas/edit-request', (id, editor) => {
			if (editor === 'crop') enterCropMode(ctx, cropState, id);
		});

		let detachDrops: (() => void) | undefined;
		const followCanvas = (element: HTMLCanvasElement | undefined): void => {
			detachDrops?.();
			detachDrops = undefined;
			if (element) detachDrops = watchDrops(ctx, element);
		};
		ctx.on('renderer/canvas-change', followCanvas);
		followCanvas(ctx.renderer.canvasElement);
		ctx.effect(
			() => () => {
				detachDrops?.();
				detachDrops = undefined;
			},
			'image drop listeners'
		);
	}
};
