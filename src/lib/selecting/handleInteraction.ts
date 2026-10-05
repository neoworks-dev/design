// The resize handles and rotation zones as an overlay part: drawn on the overlay canvas,
// hit-tested by the canvas input router (a claimant), so a press on a handle never reaches the
// Move tool.

import type { Context } from '@neoworks/extension-system';
import type { OverlayFrame } from '../overlay/types';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { Point, ToolPointerEvent } from '../tools/protocol';
import { cursorFor, handleBox, handleWorldPoint, sizeLabel, type HandleBox } from './handles';
import { HANDLE_IDS, type HandleId } from './resize';
import type { ResizeFeedbackState } from './resizeFeedback.svelte';
import type { ResizeGesture } from './resizeGesture';
import type { RotateGesture } from './rotateGesture';

const HANDLE_SIZE = 8;
const HIT_SIZE = 16;
const ZONE_RADIUS = 13;
const ZONE_OFFSET = 15;
const PILL_WIDTH = 64;
const PILL_HEIGHT = 20;
const PRIMARY_BUTTON = 0;
const BLUE = '#3b82f6';
const CORNERS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'];
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>'
)}") 12 12, grab`;

export interface HandleInteractionOptions {
	id: string;
	/** The handles show while this tool is active (or a gesture runs). */
	toolId: string;
	/** Rotation zones outside the corner handles; omitted where the tool cannot rotate. */
	rotation?: RotateGesture;
}

type Hit = { kind: 'handle'; handle: HandleId } | { kind: 'zone' };

export class HandleInteraction implements PointerClaimant {
	readonly id: string;
	private readonly toolId: string;
	readonly rotation: RotateGesture | undefined;

	constructor(
		private readonly ctx: Context,
		readonly feedback: ResizeFeedbackState,
		readonly gesture: ResizeGesture,
		options: HandleInteractionOptions
	) {
		this.id = options.id;
		this.toolId = options.toolId;
		this.rotation = options.rotation;
	}

	private get visible(): boolean {
		if (this.ctx.tools.activeId() === this.toolId) return true;
		return this.gesture.isActive || this.rotation?.isActive === true;
	}

	private currentBox(): HandleBox | undefined {
		return handleBox(this.ctx.document.reader, this.ctx.selection.ids);
	}

	private handlePoints(box: HandleBox): { id: HandleId; point: Point }[] {
		return HANDLE_IDS.map((id) => ({
			id,
			point: this.ctx.viewport.worldToScreen(handleWorldPoint(box, id))
		}));
	}

	private zoneCenters(box: HandleBox): Point[] {
		const first = handleWorldPoint(box, 'nw');
		const opposite = handleWorldPoint(box, 'se');
		const centre = this.ctx.viewport.worldToScreen({
			x: (first.x + opposite.x) / 2,
			y: (first.y + opposite.y) / 2
		});
		return CORNERS.map((id) => {
			const corner = this.ctx.viewport.worldToScreen(handleWorldPoint(box, id));
			const length = Math.hypot(corner.x - centre.x, corner.y - centre.y) || 1;
			return {
				x: corner.x + ((corner.x - centre.x) / length) * ZONE_OFFSET,
				y: corner.y + ((corner.y - centre.y) / length) * ZONE_OFFSET
			};
		});
	}

	private hitAt(screen: Point): Hit | undefined {
		if (!this.visible) return undefined;
		const box = this.currentBox();
		if (box === undefined) return undefined;
		const half = HIT_SIZE / 2;
		const handle = this.handlePoints(box).find(
			({ point }) => Math.abs(screen.x - point.x) <= half && Math.abs(screen.y - point.y) <= half
		);
		if (handle !== undefined) return { kind: 'handle', handle: handle.id };
		if (this.rotation === undefined) return undefined;
		const inZone = this.zoneCenters(box).some(
			(center) => Math.hypot(screen.x - center.x, screen.y - center.y) <= ZONE_RADIUS
		);
		if (inZone) return { kind: 'zone' };
		return undefined;
	}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const hit = this.hitAt(event.screen);
		if (hit === undefined) return undefined;
		if (hit.kind === 'handle') return this.grabResize(hit.handle, event);
		return this.grabRotation(event);
	}

	private grabResize(handle: HandleId, event: ToolPointerEvent): PointerGrab | undefined {
		if (!this.gesture.begin(handle, event.world)) return undefined;
		return {
			move: (move) => this.gesture.update(move.world, move),
			up: () => this.gesture.commit(),
			cancel: () => this.gesture.cancel()
		};
	}

	private grabRotation(event: ToolPointerEvent): PointerGrab | undefined {
		const rotation = this.rotation;
		if (rotation === undefined || !rotation.begin(event.world)) return undefined;
		return {
			move: (move) => rotation.update(move.world, move),
			up: () => rotation.commit(),
			cancel: () => rotation.cancel()
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		const hit = this.hitAt(event.screen);
		if (hit === undefined) return undefined;
		if (hit.kind === 'handle') return cursorFor(hit.handle);
		return ROTATE_CURSOR;
	}

	track(): void {
		void this.ctx.selection.ids;
		void this.ctx.tools.activeId();
		void this.feedback.size;
		void this.feedback.angle;
	}

	draw(frame: OverlayFrame): void {
		const box = this.currentBox();
		if (box === undefined) return;
		if (this.visible) {
			this.drawBoxOutline(frame.ctx, box);
			this.drawHandles(frame.ctx, box);
		}
		this.drawPill(frame.ctx, box);
	}

	/** The selection box itself: for a multi selection nothing else outlines it. */
	private drawBoxOutline(canvas: CanvasRenderingContext2D, box: HandleBox): void {
		const corners = CORNERS.map((id) => this.ctx.viewport.worldToScreen(handleWorldPoint(box, id)));
		canvas.lineWidth = 1;
		canvas.strokeStyle = BLUE;
		canvas.beginPath();
		corners.forEach((corner, index) => {
			if (index === 0) canvas.moveTo(corner.x, corner.y);
			else canvas.lineTo(corner.x, corner.y);
		});
		canvas.closePath();
		canvas.stroke();
	}

	private drawHandles(canvas: CanvasRenderingContext2D, box: HandleBox): void {
		canvas.lineWidth = 1;
		canvas.fillStyle = 'white';
		canvas.strokeStyle = BLUE;
		for (const { point } of this.handlePoints(box)) {
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

	private pillLabel(): string | undefined {
		if (this.feedback.angle !== null) return `${Math.round(this.feedback.angle)}°`;
		if (this.feedback.size === null) return undefined;
		return sizeLabel(this.feedback.size);
	}

	private drawPill(canvas: CanvasRenderingContext2D, box: HandleBox): void {
		const label = this.pillLabel();
		if (label === undefined) return;
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
		canvas.fillText(label, bottom.x, centerY + 4);
	}
}

/** Draws the handles on the overlay and lets the canvas input router hit-test them. */
export function contributeHandles(ctx: Context, handles: HandleInteraction): void {
	ctx.effect(
		() =>
			ctx.overlay.register({
				id: handles.id,
				order: 60,
				track: () => handles.track(),
				draw: (frame) => handles.draw(frame)
			}),
		`${handles.id} overlay`
	);
	ctx.effect(() => ctx.canvasInput.claim(handles), `${handles.id} pointer claim`);
}
