// Draws snap guides, equal-spacing brackets and Alt+hover measurements on the overlay layer (#38).
// Everything is computed in page units by the snapping service and mapped to screen space here,
// so lines stay one pixel wide at any zoom and labels keep a constant size.

import type { OverlayFrame } from '../overlay/types';
import { projectMeasurement, type Measurement, type ScreenMeasureLine } from './measure';
import type { Point, SnapGuide } from './snap';
import type { GapGuide } from './spacing';

export const GUIDE_COLOR = '#f24822';
export const MEASURE_COLOR = '#f24822';
const MARKER_RADIUS = 3;
const CAP_LENGTH = 4;
const LABEL_FONT = '600 11px Inter, system-ui, sans-serif';
const LABEL_PADDING_X = 4;
const LABEL_HEIGHT = 16;

export interface SnapOverlayState {
	guides: readonly SnapGuide[];
	gaps: readonly GapGuide[];
	measurement: Measurement | null;
}

export function hasSnapOverlay(state: SnapOverlayState): boolean {
	return state.guides.length > 0 || state.gaps.length > 0 || state.measurement !== null;
}

export function drawSnapOverlay(frame: OverlayFrame, state: SnapOverlayState): void {
	if (!hasSnapOverlay(state)) return;
	const { ctx } = frame;
	ctx.lineWidth = 1;
	ctx.strokeStyle = GUIDE_COLOR;
	ctx.fillStyle = GUIDE_COLOR;
	for (const guide of state.guides) drawGuide(frame, guide);
	const gapLines = projectMeasurement(state.gaps, frame.worldToScreen);
	for (const line of gapLines) drawDistanceLine(frame, line);
	if (state.measurement === null) return;
	const measured = [...state.measurement.target, ...state.measurement.container];
	for (const line of projectMeasurement(measured, frame.worldToScreen)) {
		drawDistanceLine(frame, line);
	}
}

/** Offsets by half a pixel so a one pixel line covers whole device pixels. */
function crisp(value: number): number {
	return Math.round(value) + 0.5;
}

function drawGuide(frame: OverlayFrame, guide: SnapGuide): void {
	const { ctx } = frame;
	const start = guideEnd(frame, guide, guide.start);
	const end = guideEnd(frame, guide, guide.end);
	ctx.beginPath();
	ctx.moveTo(crisp(start.x), crisp(start.y));
	ctx.lineTo(crisp(end.x), crisp(end.y));
	ctx.stroke();
	for (const marker of guide.markers) drawMarker(frame, marker);
}

function guideEnd(frame: OverlayFrame, guide: SnapGuide, along: number): Point {
	if (guide.axis === 'x') return frame.worldToScreen({ x: guide.position, y: along });
	return frame.worldToScreen({ x: along, y: guide.position });
}

function drawMarker(frame: OverlayFrame, marker: Point): void {
	const { ctx } = frame;
	const center = frame.worldToScreen(marker);
	const x = crisp(center.x);
	const y = crisp(center.y);
	ctx.beginPath();
	ctx.moveTo(x - MARKER_RADIUS, y - MARKER_RADIUS);
	ctx.lineTo(x + MARKER_RADIUS, y + MARKER_RADIUS);
	ctx.moveTo(x - MARKER_RADIUS, y + MARKER_RADIUS);
	ctx.lineTo(x + MARKER_RADIUS, y - MARKER_RADIUS);
	ctx.stroke();
}

function drawDistanceLine(frame: OverlayFrame, line: ScreenMeasureLine): void {
	const { ctx } = frame;
	if (line.extension) drawExtension(frame, line.extension);
	ctx.beginPath();
	ctx.moveTo(crisp(line.from.x), crisp(line.from.y));
	ctx.lineTo(crisp(line.to.x), crisp(line.to.y));
	drawCap(frame, line.from, line.to);
	drawCap(frame, line.to, line.from);
	ctx.stroke();
	drawLabel(frame, line.label, line.labelAt);
}

/** A short tick across the line at `at`, perpendicular to the direction towards `towards`. */
function drawCap(frame: OverlayFrame, at: Point, towards: Point): void {
	const { ctx } = frame;
	const horizontal = Math.abs(towards.x - at.x) >= Math.abs(towards.y - at.y);
	const x = crisp(at.x);
	const y = crisp(at.y);
	if (horizontal) {
		ctx.moveTo(x, y - CAP_LENGTH);
		ctx.lineTo(x, y + CAP_LENGTH);
		return;
	}
	ctx.moveTo(x - CAP_LENGTH, y);
	ctx.lineTo(x + CAP_LENGTH, y);
}

function drawExtension(frame: OverlayFrame, extension: { from: Point; to: Point }): void {
	const { ctx } = frame;
	ctx.save();
	ctx.setLineDash([3, 3]);
	ctx.beginPath();
	ctx.moveTo(crisp(extension.from.x), crisp(extension.from.y));
	ctx.lineTo(crisp(extension.to.x), crisp(extension.to.y));
	ctx.stroke();
	ctx.restore();
}

function drawLabel(frame: OverlayFrame, text: string, center: Point): void {
	const { ctx } = frame;
	ctx.save();
	ctx.font = LABEL_FONT;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const width = ctx.measureText(text).width + LABEL_PADDING_X * 2;
	ctx.fillStyle = MEASURE_COLOR;
	ctx.beginPath();
	ctx.roundRect(center.x - width / 2, center.y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT, 3);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.fillText(text, center.x, center.y + 0.5);
	ctx.restore();
}
