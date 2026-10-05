// The shape specific handles (corner radius, arc, polygon points) as an overlay part: drawn on the
// overlay canvas, hit-tested by the canvas input router, like the resize handles.

import type { Context } from '@neoworks/extension-system';
import { transformPoint } from '../document';
import type { OverlayFrame } from '../overlay/types';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { Point, ToolPointerEvent } from '../tools/protocol';
import type { ShapeHandleFeedbackState } from './shapeHandleFeedback.svelte';
import type { ShapeHandleGesture } from './shapeHandleGesture';
import { shapeHandles, type ShapeHandle } from './shapeHandles';

const HANDLE_RADIUS = 5;
const HIT_RADIUS = 8;
const PRIMARY_BUTTON = 0;
const BLUE = '#3b82f6';

interface PlacedHandle {
	handle: ShapeHandle;
	point: Point;
}

export class ShapeHandleInteraction implements PointerClaimant {
	readonly id = 'shape-handles/handles';

	constructor(
		private readonly ctx: Context,
		readonly feedback: ShapeHandleFeedbackState,
		readonly gesture: ShapeHandleGesture
	) {}

	private selectedId(): string | undefined {
		const ids = this.ctx.selection.ids;
		if (ids.length !== 1) return undefined;
		return ids[0];
	}

	/** Screen pixels per local unit of the node, along its own x axis. */
	private pixelsPerUnit(id: string): number {
		const [[a], [b]] = this.ctx.document.absoluteTransform(id);
		return this.ctx.viewport.zoom * Math.hypot(a, b);
	}

	private placedHandles(): PlacedHandle[] {
		const visible = this.ctx.tools.activeId() === 'move' || this.gesture.isActive;
		const id = this.selectedId();
		if (!visible || id === undefined) return [];
		const node = this.ctx.document.get(id);
		if (node === undefined) return [];
		const absolute = this.ctx.document.absoluteTransform(id);
		return shapeHandles(node, this.pixelsPerUnit(id)).map((handle) => ({
			handle,
			point: this.ctx.viewport.worldToScreen(
				transformPoint(absolute, handle.local.x, handle.local.y)
			)
		}));
	}

	private handleAt(screen: Point): ShapeHandle | undefined {
		const hit = this.placedHandles().find(
			({ point }) => Math.hypot(screen.x - point.x, screen.y - point.y) <= HIT_RADIUS
		);
		return hit?.handle;
	}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const id = this.selectedId();
		const handle = this.handleAt(event.screen);
		if (id === undefined || handle === undefined) return undefined;
		if (!this.gesture.begin(id, handle, event.world, this.pixelsPerUnit(id))) return undefined;
		return {
			move: (move) => this.gesture.update(move.world, move),
			up: () => this.gesture.commit(),
			cancel: () => this.gesture.cancel()
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		if (this.handleAt(event.screen) === undefined) return undefined;
		return 'pointer';
	}

	track(): void {
		void this.ctx.selection.ids;
		void this.ctx.tools.activeId();
		void this.feedback.readout;
	}

	draw(frame: OverlayFrame): void {
		const canvas = frame.ctx;
		canvas.lineWidth = 1.5;
		canvas.fillStyle = 'white';
		canvas.strokeStyle = BLUE;
		for (const { point } of this.placedHandles()) {
			canvas.beginPath();
			canvas.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
			canvas.fill();
			canvas.stroke();
		}
		this.drawReadout(canvas);
	}

	private drawReadout(canvas: CanvasRenderingContext2D): void {
		const readout = this.feedback.readout;
		if (readout === null) return;
		const point = this.ctx.viewport.worldToScreen(readout.world);
		const x = point.x + 18;
		const y = point.y - 14;
		canvas.fillStyle = BLUE;
		canvas.beginPath();
		canvas.roundRect(x - 4, y - 12, readout.text.length * 7 + 10, 18, 4);
		canvas.fill();
		canvas.fillStyle = 'white';
		canvas.font = '11px sans-serif';
		canvas.textAlign = 'left';
		canvas.fillText(readout.text, x + 1, y + 1);
	}
}
