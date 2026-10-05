// Draws the rulers and guides on the overlay canvas (#72). Screen space, CSS pixels.

import type { Rect } from '../document';
import type { OverlayFrame } from '../overlay/types';
import type { GuideDraft } from '../services/rulersGuidesState.svelte';
import type { PlacedGuide } from './guides';
import { rulerTicks } from './ticks';

export const RULER_SIZE = 20;
const GUIDE_COLOR = '#ff4d6d';
const BACKGROUND = 'rgba(32, 32, 34, 0.94)';
const TICK_COLOR = '#8e8e93';
const LABEL_COLOR = '#c7c7cc';
const SELECTION_COLOR = 'rgba(59, 130, 246, 0.4)';
const MINOR_TICK = 4;
const MAJOR_TICK = 9;

export interface RulerView {
	/** Union of the selected nodes in page coordinates, when something is selected. */
	selection: Rect | undefined;
}

function crisp(position: number): number {
	return Math.round(position) + 0.5;
}

function drawBackground(canvas: CanvasRenderingContext2D, width: number, height: number): void {
	canvas.fillStyle = BACKGROUND;
	canvas.fillRect(0, 0, width, RULER_SIZE);
	canvas.fillRect(0, 0, RULER_SIZE, height);
}

function drawSelectionRange(frame: OverlayFrame, selection: Rect | undefined): void {
	if (selection === undefined) return;
	const screen = frame.worldRectToScreen(selection);
	frame.ctx.fillStyle = SELECTION_COLOR;
	frame.ctx.fillRect(screen.x, 0, screen.width, RULER_SIZE);
	frame.ctx.fillRect(0, screen.y, RULER_SIZE, screen.height);
}

function drawTopTicks(frame: OverlayFrame): void {
	const { ctx: canvas, camera, size } = frame;
	const from = (RULER_SIZE - camera.x) / camera.scale;
	const to = (size.width - camera.x) / camera.scale;
	canvas.strokeStyle = TICK_COLOR;
	canvas.fillStyle = LABEL_COLOR;
	canvas.lineWidth = 1;
	canvas.font = '10px sans-serif';
	canvas.textAlign = 'left';
	for (const tick of rulerTicks(from, to, camera.scale)) {
		const x = crisp(tick.position * camera.scale + camera.x);
		const length = tick.major ? MAJOR_TICK : MINOR_TICK;
		canvas.beginPath();
		canvas.moveTo(x, RULER_SIZE);
		canvas.lineTo(x, RULER_SIZE - length);
		canvas.stroke();
		if (tick.major) canvas.fillText(String(tick.position), x + 3, 10);
	}
}

function drawLeftTicks(frame: OverlayFrame): void {
	const { ctx: canvas, camera, size } = frame;
	const from = (RULER_SIZE - camera.y) / camera.scale;
	const to = (size.height - camera.y) / camera.scale;
	canvas.strokeStyle = TICK_COLOR;
	canvas.fillStyle = LABEL_COLOR;
	canvas.lineWidth = 1;
	canvas.font = '10px sans-serif';
	canvas.textAlign = 'right';
	for (const tick of rulerTicks(from, to, camera.scale)) {
		const y = crisp(tick.position * camera.scale + camera.y);
		const length = tick.major ? MAJOR_TICK : MINOR_TICK;
		canvas.beginPath();
		canvas.moveTo(RULER_SIZE, y);
		canvas.lineTo(RULER_SIZE - length, y);
		canvas.stroke();
		if (!tick.major) continue;
		canvas.save();
		canvas.translate(10, y - 3);
		canvas.rotate(-Math.PI / 2);
		canvas.fillText(String(tick.position), 0, 0);
		canvas.restore();
	}
}

/** The rulers along the top and left edge, with the selection's range highlighted. */
export function drawRulers(frame: OverlayFrame, view: RulerView): void {
	const canvas = frame.ctx;
	canvas.save();
	drawBackground(canvas, frame.size.width, frame.size.height);
	canvas.beginPath();
	canvas.rect(RULER_SIZE, 0, frame.size.width - RULER_SIZE, RULER_SIZE);
	canvas.clip();
	drawSelectionRange(frame, view.selection);
	drawTopTicks(frame);
	canvas.restore();
	canvas.save();
	canvas.beginPath();
	canvas.rect(0, RULER_SIZE, RULER_SIZE, frame.size.height - RULER_SIZE);
	canvas.clip();
	drawSelectionRange(frame, view.selection);
	drawLeftTicks(frame);
	canvas.restore();
	canvas.fillStyle = BACKGROUND;
	canvas.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
}

function strokeGuide(
	frame: OverlayFrame,
	axis: 'X' | 'Y',
	position: number,
	span: PlacedGuide['span'],
	alpha: number
): void {
	const { ctx: canvas, camera, size } = frame;
	canvas.globalAlpha = alpha;
	canvas.strokeStyle = GUIDE_COLOR;
	canvas.lineWidth = 1;
	canvas.beginPath();
	if (axis === 'X') {
		const x = crisp(position * camera.scale + camera.x);
		const start = span === undefined ? 0 : span.start * camera.scale + camera.y;
		const end = span === undefined ? size.height : span.end * camera.scale + camera.y;
		canvas.moveTo(x, start);
		canvas.lineTo(x, end);
	} else {
		const y = crisp(position * camera.scale + camera.y);
		const start = span === undefined ? 0 : span.start * camera.scale + camera.x;
		const end = span === undefined ? size.width : span.end * camera.scale + camera.x;
		canvas.moveTo(start, y);
		canvas.lineTo(end, y);
	}
	canvas.stroke();
	canvas.globalAlpha = 1;
}

/** The guides of the page, minus the one being moved, then the guide being dragged. */
export function drawGuides(
	frame: OverlayFrame,
	guides: readonly PlacedGuide[],
	draft: GuideDraft | null
): void {
	for (const guide of guides) {
		const moving = draft?.moving;
		if (moving !== undefined && moving.ownerId === guide.ownerId && moving.index === guide.index) {
			continue;
		}
		strokeGuide(frame, guide.axis, guide.position, guide.span, 1);
	}
	if (draft === null) return;
	let alpha = 1;
	if (draft.overRuler) alpha = 0.35;
	strokeGuide(frame, draft.axis, draft.position, undefined, alpha);
}
