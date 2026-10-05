// Draws layout grids on the overlay layer (#38, #73): translucent bands for COLUMNS and ROWS, hair
// lines for GRID. Positions come from grids.ts in frame space and go through the frame's absolute
// transform and the camera, so a rotated frame draws rotated and lines stay one pixel wide.

import type { LayoutGrid, Matrix2x3, RGBA } from '../document/types';
import { transformPoint } from '../document/matrix';
import type { OverlayFrame } from '../overlay/types';
import { gridLines, gridTracks } from './grids';

export interface GridFrame {
	id: string;
	/** Absolute transform of the frame. */
	matrix: Matrix2x3;
	width: number;
	height: number;
	grids: readonly LayoutGrid[];
}

/** Hair lines closer than this on screen are skipped: they would only paint a haze. */
const MIN_LINE_SPACING_PIXELS = 4;

export function cssColor(color: RGBA): string {
	const red = Math.round(color.r * 255);
	const green = Math.round(color.g * 255);
	const blue = Math.round(color.b * 255);
	return `rgba(${red}, ${green}, ${blue}, ${color.a})`;
}

type ToScreen = (x: number, y: number) => { x: number; y: number };

function screenMapper(frame: OverlayFrame, target: GridFrame): ToScreen {
	return (x, y) => {
		const world = transformPoint(target.matrix, x, y);
		return frame.worldToScreen(world);
	};
}

function fillBand(
	frame: OverlayFrame,
	toScreen: ToScreen,
	band: { x: number; y: number; width: number; height: number },
	color: RGBA
): void {
	const { ctx } = frame;
	const corners = [
		toScreen(band.x, band.y),
		toScreen(band.x + band.width, band.y),
		toScreen(band.x + band.width, band.y + band.height),
		toScreen(band.x, band.y + band.height)
	];
	ctx.beginPath();
	ctx.moveTo(corners[0].x, corners[0].y);
	for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
	ctx.closePath();
	ctx.fillStyle = cssColor(color);
	ctx.fill();
}

function drawBands(frame: OverlayFrame, target: GridFrame, grid: LayoutGrid): void {
	const toScreen = screenMapper(frame, target);
	const vertical = grid.pattern === 'COLUMNS';
	const length = vertical ? target.width : target.height;
	for (const track of gridTracks(grid, length)) {
		if (vertical) {
			const band = { x: track.start, y: 0, width: track.end - track.start, height: target.height };
			fillBand(frame, toScreen, band, grid.color);
			continue;
		}
		const band = { x: 0, y: track.start, width: target.width, height: track.end - track.start };
		fillBand(frame, toScreen, band, grid.color);
	}
}

function strokeLine(
	frame: OverlayFrame,
	from: { x: number; y: number },
	to: { x: number; y: number }
): void {
	const { ctx } = frame;
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
}

function drawLines(frame: OverlayFrame, target: GridFrame, grid: LayoutGrid): void {
	const toScreen = screenMapper(frame, target);
	const origin = toScreen(0, 0);
	const unit = toScreen(1, 0);
	const pixelsPerUnit = Math.hypot(unit.x - origin.x, unit.y - origin.y);
	const size = grid.sectionSize === undefined ? 0 : grid.sectionSize;
	if (size * pixelsPerUnit < MIN_LINE_SPACING_PIXELS) return;
	frame.ctx.lineWidth = 1;
	frame.ctx.strokeStyle = cssColor({ ...grid.color, a: Math.min(1, grid.color.a * 2) });
	for (const x of gridLines(grid, target.width)) {
		strokeLine(frame, toScreen(x, 0), toScreen(x, target.height));
	}
	for (const y of gridLines(grid, target.height)) {
		strokeLine(frame, toScreen(0, y), toScreen(target.width, y));
	}
}

export function drawLayoutGrids(frame: OverlayFrame, targets: readonly GridFrame[]): void {
	for (const target of targets) {
		for (const grid of target.grids) {
			if (!grid.visible) continue;
			if (grid.pattern === 'GRID') {
				drawLines(frame, target, grid);
				continue;
			}
			drawBands(frame, target, grid);
		}
	}
}
