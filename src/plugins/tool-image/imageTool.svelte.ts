// The image tool: after the file picker (Ctrl+Shift+K) the chosen images wait on the tool; a
// click places them in a row at natural size, a drag sizes the first one to the dragged box.

import type { Context } from '@neoworks/extension-system';
import { placeImages, type PreparedImage } from '../../lib/editing/placeImages';
import type { ToolContribution } from '../../lib/registries/tools.svelte';
import { dragBounds } from '../../lib/tools/creation';
import { PointerGesture, type Point, type ToolPointerEvent } from '../../lib/tools/protocol';
import type { CreationPreview } from '../../lib/editing/creationTool.svelte';

export const IMAGE_TOOL_ID = 'image';

/** The images waiting to be placed. */
export class PendingImages {
	images = $state.raw<PreparedImage[]>([]);
}

type ImageHandlers = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onCancel' | 'onDeactivate'
>;

export function createImageTool(
	ctx: Context,
	pending: PendingImages,
	preview: CreationPreview
): ImageHandlers {
	const gesture = new PointerGesture();
	let startWorld: Point = { x: 0, y: 0 };
	let startScreen: Point = { x: 0, y: 0 };

	const stop = (): void => {
		gesture.cancel();
		preview.shape = null;
	};

	const finish = (): void => {
		pending.images = [];
		ctx.tools.completeOperation();
	};

	return {
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== 0 || pending.images.length === 0) return;
			startWorld = event.world;
			startScreen = event.screen;
			gesture.press(event.screen);
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (gesture.phase === 'idle') return;
			const update = gesture.move(event.screen);
			if (update.phase !== 'dragging') return;
			preview.shape = { kind: 'box', rect: dragBounds(startScreen, event.screen, event) };
		},
		onPointerUp(event: ToolPointerEvent): void {
			const result = gesture.release();
			preview.shape = null;
			if (result === 'none') return;
			if (result === 'click') {
				placeImages(ctx, pending.images, { at: event.world });
				finish();
				return;
			}
			const box = dragBounds(startWorld, event.world, event);
			placeImages(ctx, pending.images, {
				at: { x: box.x, y: box.y },
				firstSize: { width: box.width, height: box.height }
			});
			finish();
		},
		onDeactivate(): void {
			stop();
			pending.images = [];
		},
		onCancel(): boolean {
			if (pending.images.length === 0) return false;
			stop();
			finish();
			return true;
		}
	};
}
