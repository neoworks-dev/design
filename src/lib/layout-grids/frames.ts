// Which frames of the current page carry visible layout grids, and the snap lines they offer.

import type { Context } from '@neoworks/extension-system';
import { isFrameLike } from '../document';
import type { SnapLine } from '../snapping/lineSnap';
import type { GridFrame } from './draw';
import { snapPositions } from './grids';

/** Frames below the current page that have at least one visible grid. Reactive. */
export function gridFrames(ctx: Context): GridFrame[] {
	const nodes = ctx.document.query((node) => {
		if (!isFrameLike(node) || !('layoutGrids' in node)) return false;
		return node.visible && node.layoutGrids.some((grid) => grid.visible);
	}, ctx.document.currentPageId);
	const frames: GridFrame[] = [];
	for (const node of nodes) {
		if (!('layoutGrids' in node)) continue;
		frames.push({
			id: node.id,
			matrix: ctx.document.absoluteTransform(node.id),
			width: node.width,
			height: node.height,
			grids: node.layoutGrids
		});
	}
	return frames;
}

function isAxisAligned(frame: GridFrame): boolean {
	const [[a, c], [b, d]] = frame.matrix;
	return b === 0 && c === 0 && a > 0 && d > 0;
}

/**
 * Snap lines of the grids, in page coordinates. Rotated or flipped frames offer none: their grid
 * lines are not axis aligned. A line reaches across its own frame only.
 */
export function gridSnapLines(frames: readonly GridFrame[]): SnapLine[] {
	const lines: SnapLine[] = [];
	for (const frame of frames) {
		if (!isAxisAligned(frame)) continue;
		const [[a, , e], [, d, f]] = frame.matrix;
		const positions = snapPositions(frame.grids, frame.width, frame.height);
		const verticalSpan = { start: f, end: f + frame.height * d };
		const horizontalSpan = { start: e, end: e + frame.width * a };
		for (const x of positions.x) lines.push({ axis: 'x', position: e + x * a, span: verticalSpan });
		for (const y of positions.y) {
			lines.push({ axis: 'y', position: f + y * d, span: horizontalSpan });
		}
	}
	return lines;
}
