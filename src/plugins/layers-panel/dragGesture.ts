// The pointer gesture of dragging layer rows. It turns pointer events on the scrolling list into
// `ctx.layers` drag calls; where a drop lands and what it does is the service's business.

import type { Context } from '@neoworks/extension-system';

const DRAG_THRESHOLD_PIXELS = 4;
const EDGE_SCROLL_ZONE_PIXELS = 24;
const EDGE_SCROLL_STEP_PIXELS = 12;
const ROW_LEFT_PADDING_PIXELS = 4;

export interface DragGestureOptions {
	scroller: () => HTMLElement | undefined;
	indentPixels: number;
}

interface Press {
	rowId: string;
	pointerId: number;
	x: number;
	y: number;
}

export interface DragGesture {
	pointerdown(event: PointerEvent): void;
	pointermove(event: PointerEvent): void;
	pointerup(event: PointerEvent): void;
	pointercancel(event: PointerEvent): void;
}

function rowIdUnder(target: EventTarget | null): string | undefined {
	if (!(target instanceof Element)) return undefined;
	if (target.closest('button, input')) return undefined;
	const row = target.closest<HTMLElement>('[data-layer-row]');
	return row?.dataset.layerRow;
}

export function createDragGesture(ctx: Context, options: DragGestureOptions): DragGesture {
	let press: Press | undefined;
	let stopEscape: (() => void) | undefined;

	function finish(): void {
		press = undefined;
		stopEscape?.();
		stopEscape = undefined;
	}

	function cancel(): void {
		ctx.layers.cancelDrag();
		finish();
	}

	// Esc cancels a drag in progress. The listener exists only while dragging.
	function listenForEscape(): void {
		const dispose = ctx.effect(() => {
			const onkeydown = (event: KeyboardEvent): void => {
				if (event.key !== 'Escape') return;
				event.stopPropagation();
				cancel();
			};
			window.addEventListener('keydown', onkeydown, true);
			return () => window.removeEventListener('keydown', onkeydown, true);
		}, 'layers-panel/drag-escape');
		stopEscape = () => void dispose();
	}

	function beginIfMoved(event: PointerEvent, current: Press, scroller: HTMLElement): void {
		const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y);
		if (moved < DRAG_THRESHOLD_PIXELS) return;
		if (!ctx.layers.beginDrag(current.rowId)) {
			finish();
			return;
		}
		scroller.setPointerCapture(current.pointerId);
		listenForEscape();
	}

	function scrollNearEdges(event: PointerEvent, scroller: HTMLElement, box: DOMRect): void {
		if (event.clientY < box.top + EDGE_SCROLL_ZONE_PIXELS) {
			scroller.scrollTop -= EDGE_SCROLL_STEP_PIXELS;
		}
		if (event.clientY > box.bottom - EDGE_SCROLL_ZONE_PIXELS) {
			scroller.scrollTop += EDGE_SCROLL_STEP_PIXELS;
		}
	}

	function track(event: PointerEvent, scroller: HTMLElement): void {
		const box = scroller.getBoundingClientRect();
		scrollNearEdges(event, scroller, box);
		const contentY = event.clientY - box.top + scroller.scrollTop;
		const offset = event.clientX - box.left - ROW_LEFT_PADDING_PIXELS;
		const pointerDepth = Math.max(0, Math.floor(offset / options.indentPixels));
		ctx.layers.updateDrag(contentY, pointerDepth);
	}

	return {
		pointerdown(event) {
			if (event.button !== 0) return;
			const rowId = rowIdUnder(event.target);
			if (rowId === undefined) return;
			press = { rowId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
		},
		pointermove(event) {
			const scroller = options.scroller();
			if (!press || !scroller) return;
			if (ctx.layers.drag === null) beginIfMoved(event, press, scroller);
			if (ctx.layers.drag === null) return;
			track(event, scroller);
		},
		pointerup(event) {
			const scroller = options.scroller();
			if (scroller && scroller.hasPointerCapture(event.pointerId)) {
				scroller.releasePointerCapture(event.pointerId);
			}
			if (ctx.layers.drag !== null) ctx.layers.commitDrag();
			finish();
		},
		pointercancel() {
			cancel();
		}
	};
}
