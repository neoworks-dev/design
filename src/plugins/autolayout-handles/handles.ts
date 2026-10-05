// The padding and gap handles of a selected auto layout frame, as an overlay part plus a pointer
// claimant: the overlay draws them, the canvas input router hands a press on one to the gesture
// before the Move tool sees it. The geometry and the drag maths are in lib/layout/handles.ts.

import type { Context } from '@neoworks/extension-system';
import type { NodeId, Rect } from '../../lib/document';
import { isStackContainer } from '../../lib/layout/build';
import {
	handleDragProps,
	handleId,
	handleLabelValue,
	layoutHandles,
	type HandleFrame,
	type HandleStart,
	type LayoutHandle
} from '../../lib/layout/handles';
import type { OverlayFrame } from '../../lib/overlay/types';
import type { PointerClaimant, PointerGrab } from '../../lib/tools/claim';
import type { Point, ToolPointerEvent } from '../../lib/tools/protocol';
import type { HandlesFeedback } from './feedback.svelte';

const PRIMARY_BUTTON = 0;
const PILL_THICKNESS = 6;
const PILL_LENGTH = 28;
const PILL_MINIMUM = 14;
const HIT_SLACK = 4;
const COLOR = '#d946ef';
const BAND_COLOR = 'rgba(217, 70, 239, 0.18)';

interface Model {
	frameId: NodeId;
	frame: HandleFrame;
	handles: LayoutHandle[];
}

interface Placed {
	handle: LayoutHandle;
	id: string;
	/** The pill in screen space. */
	pill: Rect;
	/** The band in screen space. */
	band: Rect;
}

function frameOf(ctx: Context, frameId: NodeId): HandleFrame | undefined {
	const node = ctx.document.get(frameId);
	if (node === undefined || !isStackContainer(node)) return undefined;
	if (node.layoutMode === 'GRID' || node.layoutMode === 'NONE') return undefined;
	const children: Rect[] = [];
	for (const child of ctx.document.childNodes(frameId)) {
		if (child.type === 'PAGE' || !child.visible) continue;
		if ('layoutPositioning' in child && child.layoutPositioning === 'ABSOLUTE') continue;
		children.push(ctx.document.absoluteBounds(child.id));
	}
	return {
		bounds: ctx.document.absoluteBounds(frameId),
		mode: node.layoutMode,
		wrap: node.layoutWrap === 'WRAP',
		spaceBetween: node.primaryAxisAlignItems === 'SPACE_BETWEEN',
		padding: {
			Top: node.paddingTop,
			Right: node.paddingRight,
			Bottom: node.paddingBottom,
			Left: node.paddingLeft
		},
		children
	};
}

function isAxisAligned(ctx: Context, frameId: NodeId): boolean {
	const [[a, c], [b, d]] = ctx.document.absoluteTransform(frameId);
	return Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && a > 0 && d > 0;
}

export class AutoLayoutHandles implements PointerClaimant {
	readonly id = 'autolayout-handles/handles';

	constructor(
		private readonly ctx: Context,
		private readonly feedback: HandlesFeedback
	) {}

	// ---------- model ----------

	private model(): Model | undefined {
		if (this.ctx.tools.activeId() !== 'move') return undefined;
		const ids = this.ctx.selection.ids;
		if (ids.length !== 1) return undefined;
		const frameId = ids[0];
		if (!this.ctx.document.has(frameId) || !isAxisAligned(this.ctx, frameId)) return undefined;
		const frame = frameOf(this.ctx, frameId);
		if (frame === undefined) return undefined;
		return { frameId, frame, handles: layoutHandles(frame) };
	}

	private screenRect(rect: Rect): Rect {
		const start = this.ctx.viewport.worldToScreen({ x: rect.x, y: rect.y });
		const end = this.ctx.viewport.worldToScreen({
			x: rect.x + rect.width,
			y: rect.y + rect.height
		});
		return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
	}

	private place(model: Model, toScreen: (rect: Rect) => Rect): Placed[] {
		let gapPosition = 0;
		return model.handles.map((handle) => {
			const band = toScreen(handle.band);
			let position = 0;
			if (handle.kind !== 'padding') {
				position = gapPosition;
				gapPosition += 1;
			}
			return {
				handle,
				id: handleId(handle, position),
				band,
				pill: pillOf(handle, band, model.frame.mode)
			};
		});
	}

	private hitAt(screen: Point): { model: Model; placed: Placed } | undefined {
		const model = this.model();
		if (model === undefined) return undefined;
		const placed = this.place(model, (rect) => this.screenRect(rect)).find((entry) =>
			contains(entry.pill, screen, HIT_SLACK)
		);
		if (placed === undefined) return undefined;
		return { model, placed };
	}

	// ---------- pointer ----------

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const hit = this.hitAt(event.screen);
		if (hit === undefined) return undefined;
		const gesture = new HandleGesture(
			this.ctx,
			this.feedback,
			hit.model.frameId,
			hit.placed.handle,
			hit.placed.id,
			event.world
		);
		return {
			move: (move) => gesture.update(move.world, move),
			up: () => gesture.commit(),
			cancel: () => gesture.cancel()
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		const hit = this.hitAt(event.screen);
		const next = hit === undefined ? null : hit.placed.id;
		if (this.feedback.hovered !== next) this.feedback.hovered = next;
		if (hit === undefined) return undefined;
		return cursorFor(hit.placed.handle, hit.model.frame.mode);
	}

	// ---------- drawing ----------

	track(): void {
		void this.ctx.selection.ids;
		void this.ctx.tools.activeId();
		void this.feedback.hovered;
		void this.feedback.dragging;
	}

	draw(frame: OverlayFrame): void {
		const model = this.model();
		if (model === undefined) return;
		const placed = this.place(model, (rect) => frame.worldRectToScreen(rect));
		const dragging = this.feedback.dragging;
		for (const entry of placed) {
			const active =
				entry.id === this.feedback.hovered || (dragging !== null && dragging.id === entry.id);
			if (active) fillBand(frame.ctx, entry.band);
		}
		for (const entry of placed) drawPill(frame.ctx, entry.pill);
		if (dragging === null || dragging.value === undefined) return;
		const entry = placed.find((candidate) => candidate.id === dragging.id);
		if (entry !== undefined) drawLabel(frame.ctx, entry.pill, dragging.value);
	}
}

/** A padding or gap drag: live changes in one history group, committed on release. */
class HandleGesture {
	private readonly group: ReturnType<Context['history']['beginGroup']>;
	private readonly start: HandleStart;
	private readonly mode: 'HORIZONTAL' | 'VERTICAL';
	private readonly label: string;

	constructor(
		private readonly ctx: Context,
		private readonly feedback: HandlesFeedback,
		private readonly frameId: NodeId,
		private readonly handle: LayoutHandle,
		private readonly id: string,
		private readonly startWorld: Point
	) {
		const node = ctx.document.require(frameId);
		if (!isStackContainer(node) || node.layoutMode === 'GRID' || node.layoutMode === 'NONE') {
			throw new Error(`not a stack: ${frameId}`);
		}
		this.mode = node.layoutMode;
		this.start = {
			padding: {
				Top: node.paddingTop,
				Right: node.paddingRight,
				Bottom: node.paddingBottom,
				Left: node.paddingLeft
			},
			itemSpacing: node.itemSpacing,
			counterSpacing: node.counterAxisSpacing === null ? node.itemSpacing : node.counterAxisSpacing
		};
		this.label = handle.kind === 'padding' ? 'Change padding' : 'Change spacing';
		this.group = ctx.history.beginGroup({ label: this.label });
		feedback.dragging = { id, value: undefined };
	}

	update(world: Point, modifiers: { altKey: boolean; shiftKey: boolean }): void {
		const delta = { x: world.x - this.startWorld.x, y: world.y - this.startWorld.y };
		const props = handleDragProps(this.handle, this.mode, this.start, delta, modifiers);
		const changes = this.ctx.document.setProps(this.frameId, props);
		if (changes.length > 0) {
			this.ctx.document.apply(changes, { origin: 'user', label: this.label });
		}
		this.feedback.dragging = { id: this.id, value: handleLabelValue(this.handle, props) };
	}

	commit(): void {
		this.feedback.dragging = null;
		this.ctx.history.endGroup(this.group);
	}

	cancel(): void {
		this.feedback.dragging = null;
		this.ctx.history.cancelGroup(this.group);
	}
}

// ---------- geometry in screen space ----------

function horizontalPill(band: Rect): Rect {
	const length = Math.max(PILL_MINIMUM, Math.min(PILL_LENGTH, band.width));
	return {
		x: band.x + band.width / 2 - length / 2,
		y: band.y + band.height / 2 - PILL_THICKNESS / 2,
		width: length,
		height: PILL_THICKNESS
	};
}

function verticalPill(band: Rect): Rect {
	const length = Math.max(PILL_MINIMUM, Math.min(PILL_LENGTH, band.height));
	return {
		x: band.x + band.width / 2 - PILL_THICKNESS / 2,
		y: band.y + band.height / 2 - length / 2,
		width: PILL_THICKNESS,
		height: length
	};
}

function isHorizontalPill(handle: LayoutHandle, mode: 'HORIZONTAL' | 'VERTICAL'): boolean {
	if (handle.kind === 'padding') return handle.side === 'Top' || handle.side === 'Bottom';
	if (handle.kind === 'line-gap') return true;
	return mode === 'VERTICAL';
}

function pillOf(handle: LayoutHandle, band: Rect, mode: 'HORIZONTAL' | 'VERTICAL'): Rect {
	if (isHorizontalPill(handle, mode)) return horizontalPill(band);
	return verticalPill(band);
}

function contains(rect: Rect, point: Point, slack: number): boolean {
	return (
		point.x >= rect.x - slack &&
		point.x <= rect.x + rect.width + slack &&
		point.y >= rect.y - slack &&
		point.y <= rect.y + rect.height + slack
	);
}

function cursorFor(handle: LayoutHandle, mode: 'HORIZONTAL' | 'VERTICAL'): string {
	if (isHorizontalPill(handle, mode)) return 'ns-resize';
	return 'ew-resize';
}

function fillBand(context: CanvasRenderingContext2D, band: Rect): void {
	context.fillStyle = BAND_COLOR;
	context.fillRect(band.x, band.y, band.width, band.height);
}

function drawPill(context: CanvasRenderingContext2D, pill: Rect): void {
	context.beginPath();
	context.roundRect(pill.x, pill.y, pill.width, pill.height, 3);
	context.fillStyle = COLOR;
	context.fill();
	context.lineWidth = 1;
	context.strokeStyle = '#ffffff';
	context.stroke();
}

function drawLabel(context: CanvasRenderingContext2D, pill: Rect, value: number): void {
	const text = String(value);
	context.font = '11px sans-serif';
	const width = context.measureText(text).width + 10;
	const x = pill.x + pill.width / 2 - width / 2;
	const y = pill.y - 22;
	context.beginPath();
	context.roundRect(x, y, width, 18, 4);
	context.fillStyle = COLOR;
	context.fill();
	context.fillStyle = '#ffffff';
	context.textBaseline = 'middle';
	context.fillText(text, x + 5, y + 9);
}
