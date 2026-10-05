// The resize handles as an overlay part: drawn on the overlay canvas, hit-tested by the canvas
// input router (a claimant), so a press on a handle never reaches the Move tool.

import type { Context } from '@neoworks/extension-system';
import type { OverlayFrame } from '../overlay/types';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { Point, ToolPointerEvent } from '../tools/protocol';
import { cursorFor, handleBox, handleWorldPoint, sizeLabel, type HandleBox } from './handles';
import { HANDLE_IDS, type HandleId } from './resize';
import type { ResizeFeedbackState } from './resizeFeedback.svelte';
import type { ResizeGesture } from './resizeGesture';

const HANDLE_SIZE = 8;
const HIT_SIZE = 16;
const PILL_WIDTH = 64;
const PILL_HEIGHT = 20;
const PRIMARY_BUTTON = 0;
const BLUE = '#3b82f6';

export class HandleInteraction implements PointerClaimant {
	readonly id = 'transform-handles/handles';

	constructor(
		private readonly ctx: Context,
		readonly feedback: ResizeFeedbackState,
		readonly gesture: ResizeGesture
	) {}

	private get visible(): boolean {
		return this.ctx.tools.activeId() === 'move' || this.gesture.isActive;
	}

	private currentBox(): HandleBox | undefined {
		return handleBox(this.ctx.document.reader, this.ctx.selection.ids);
	}

	private handleScreenPoints(box: HandleBox): { id: HandleId; point: Point }[] {
		return HANDLE_IDS.map((id) => ({
			id,
			point: this.ctx.viewport.worldToScreen(handleWorldPoint(box, id))
		}));
	}

	private handleAt(screen: Point): HandleId | undefined {
		if (!this.visible) return undefined;
		const box = this.currentBox();
		if (box === undefined) return undefined;
		const half = HIT_SIZE / 2;
		const hit = this.handleScreenPoints(box).find(
			({ point }) => Math.abs(screen.x - point.x) <= half && Math.abs(screen.y - point.y) <= half
		);
		return hit?.id;
	}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const handle = this.handleAt(event.screen);
		if (handle === undefined) return undefined;
		if (!this.gesture.begin(handle, event.world)) return undefined;
		return {
			move: (move) => this.gesture.update(move.world, move),
			up: () => this.gesture.commit(),
			cancel: () => this.gesture.cancel()
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		const handle = this.handleAt(event.screen);
		if (handle === undefined) return undefined;
		return cursorFor(handle);
	}

	track(): void {
		void this.ctx.selection.ids;
		void this.ctx.tools.activeId();
		void this.feedback.size;
	}

	draw(frame: OverlayFrame): void {
		const box = this.currentBox();
		if (box === undefined) return;
		if (this.visible) this.drawHandles(frame.ctx, box);
		this.drawPill(frame.ctx, box);
	}

	private drawHandles(canvas: CanvasRenderingContext2D, box: HandleBox): void {
		canvas.lineWidth = 1;
		canvas.fillStyle = 'white';
		canvas.strokeStyle = BLUE;
		for (const { point } of this.handleScreenPoints(box)) {
			canvas.fillRect(
				point.x - HANDLE_SIZE / 2,
				point.y - HANDLE_SIZE / 2,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
			canvas.strokeRect(
				point.x - HANDLE_SIZE / 2,
				point.y - HANDLE_SIZE / 2,
				HANDLE_SIZE,
				HANDLE_SIZE
			);
		}
	}

	private drawPill(canvas: CanvasRenderingContext2D, box: HandleBox): void {
		const size = this.feedback.size;
		if (size === null) return;
		const bottom = this.ctx.viewport.worldToScreen(handleWorldPoint(box, 's'));
		const centerY = bottom.y + 22;
		canvas.fillStyle = BLUE;
		canvas.beginPath();
		canvas.roundRect(
			bottom.x - PILL_WIDTH / 2,
			centerY - PILL_HEIGHT / 2,
			PILL_WIDTH,
			PILL_HEIGHT,
			4
		);
		canvas.fill();
		canvas.fillStyle = 'white';
		canvas.font = '11px sans-serif';
		canvas.textAlign = 'center';
		canvas.fillText(sizeLabel(size), bottom.x, centerY + 4);
	}
}
