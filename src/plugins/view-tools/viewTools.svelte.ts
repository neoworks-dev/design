import type { Context } from '@neoworks/extension-system';
import type { Rect } from '../../lib/document/types';
import type { ToolContribution } from '../../lib/registries/tools.svelte';
import { PointerGesture, type Point, type ToolPointerEvent } from '../../lib/tools/protocol';
import { MAX_SCALE, nextZoomStop } from '../../lib/viewport/camera';

const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

/** Reactive state the hand tool's cursor and the zoom tool's marquee overlay read. */
export class ViewToolState {
	panning = $state(false);
	/** The zoom drag rectangle in canvas pixels, or null when no drag is running. */
	marquee = $state.raw<Rect | null>(null);
	/** Alt held over the zoom tool: the cursor shows zoom out. */
	zoomOut = $state(false);
}

export function rectBetween(from: Point, to: Point): Rect {
	return {
		x: Math.min(from.x, to.x),
		y: Math.min(from.y, to.y),
		width: Math.abs(to.x - from.x),
		height: Math.abs(to.y - from.y)
	};
}

type ToolBehaviour = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onDeactivate' | 'onCancel' | 'cursor'
>;

/** Hand: drag moves the camera. Space-hold and middle-drag use it temporarily. */
export function createHandTool(ctx: Context, state: ViewToolState): ToolBehaviour {
	let last: Point | undefined;
	const stop = (): void => {
		last = undefined;
		state.panning = false;
	};
	return {
		cursor: () => {
			if (state.panning) return 'grabbing';
			return 'grab';
		},
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON && event.button !== MIDDLE_BUTTON) return;
			last = event.screen;
			state.panning = true;
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (!last) return;
			ctx.viewport.panBy(event.screen.x - last.x, event.screen.y - last.y);
			last = event.screen;
		},
		onPointerUp: stop,
		onDeactivate: stop
	};
}

/** Zoom: click zooms in at the cursor, Alt-click out, dragging a rectangle zooms to it. */
export function createZoomTool(ctx: Context, state: ViewToolState): ToolBehaviour {
	const gesture = new PointerGesture();
	const stop = (): void => {
		gesture.cancel();
		state.marquee = null;
	};
	return {
		cursor: () => {
			if (state.zoomOut) return 'zoom-out';
			return 'zoom-in';
		},
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON) return;
			gesture.press(event.screen);
		},
		onPointerMove(event: ToolPointerEvent): void {
			state.zoomOut = event.altKey;
			if (gesture.phase === 'idle') return;
			const update = gesture.move(event.screen);
			if (update.phase !== 'dragging') return;
			state.marquee = rectBetween(gesture.start, event.screen);
		},
		onPointerUp(event: ToolPointerEvent): void {
			const start = gesture.start;
			const result = gesture.release();
			state.marquee = null;
			if (result === 'click') zoomStep(ctx, event);
			if (result === 'drag') zoomToDrag(ctx, start, event);
		},
		onDeactivate: stop,
		onCancel(): boolean {
			if (gesture.phase === 'idle') return false;
			stop();
			return true;
		}
	};
}

function zoomStep(ctx: Context, event: ToolPointerEvent): void {
	let direction: 'in' | 'out' = 'in';
	if (event.altKey) direction = 'out';
	ctx.viewport.zoomAt(event.screen, nextZoomStop(ctx.viewport.zoom, direction));
}

function zoomToDrag(ctx: Context, start: Point, event: ToolPointerEvent): void {
	const rect = rectBetween(ctx.viewport.screenToWorld(start), event.world);
	ctx.viewport.zoomToRect(rect, { padding: 0, maxScale: MAX_SCALE });
}
