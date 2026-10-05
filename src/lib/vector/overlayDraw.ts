// Screen-space drawing of vector networks for the overlay service: the path, anchor points and
// handles. Used by the pen, the pencil and vector edit mode. Plain Canvas2D, no kernel.

import type { OverlayFrame } from '../overlay/types';
import type { Matrix2x3, VectorNetwork } from '../document/types';
import { transformPoint } from '../document/matrix';
import { segmentControls, validSegment, type Point } from './geometry';
import { segmentsAt, tangentAtVertex } from './network';

const ACCENT = '#0d99ff';
const POINT_HALF_SIZE = 3.5;
const HANDLE_RADIUS = 3;

export interface NetworkDrawOptions {
	selectedVertices?: ReadonlySet<number>;
	selectedSegments?: ReadonlySet<number>;
	hoverVertex?: number;
	hoverSegment?: number;
	/** Handles are drawn for these vertices (all vertices when undefined). */
	handleVertices?: ReadonlySet<number>;
	showPoints?: boolean;
	/** Regions to tint (paint bucket hover). */
	highlightRegion?: number;
}

export function toScreen(frame: OverlayFrame, space: Matrix2x3, point: Point): Point {
	const world = transformPoint(space, point.x, point.y);
	return frame.worldToScreen(world);
}

function strokeSegment(
	frame: OverlayFrame,
	space: Matrix2x3,
	network: VectorNetwork,
	index: number
): void {
	const { ctx } = frame;
	const controls = segmentControls(network, network.segments[index]);
	const start = toScreen(frame, space, controls.start);
	const first = toScreen(frame, space, controls.firstControl);
	const second = toScreen(frame, space, controls.secondControl);
	const end = toScreen(frame, space, controls.end);
	ctx.beginPath();
	ctx.moveTo(start.x, start.y);
	ctx.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
	ctx.stroke();
}

function drawPoint(frame: OverlayFrame, at: Point, selected: boolean, hovered: boolean): void {
	const { ctx } = frame;
	const half = hovered ? POINT_HALF_SIZE + 1 : POINT_HALF_SIZE;
	ctx.fillStyle = selected ? ACCENT : '#ffffff';
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = 1.5;
	ctx.fillRect(at.x - half, at.y - half, half * 2, half * 2);
	ctx.strokeRect(at.x - half, at.y - half, half * 2, half * 2);
}

function drawHandle(frame: OverlayFrame, from: Point, to: Point): void {
	const { ctx } = frame;
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
	ctx.fillStyle = '#ffffff';
	ctx.beginPath();
	ctx.arc(to.x, to.y, HANDLE_RADIUS, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
}

function drawHandles(
	frame: OverlayFrame,
	space: Matrix2x3,
	network: VectorNetwork,
	vertices: Iterable<number>
): void {
	for (const vertexIndex of vertices) {
		const vertex = network.vertices[vertexIndex];
		if (!vertex) continue;
		const origin = toScreen(frame, space, vertex);
		for (const segmentIndex of segmentsAt(network, vertexIndex)) {
			const tangent = tangentAtVertex(network.segments[segmentIndex], vertexIndex);
			if (tangent.x === 0 && tangent.y === 0) continue;
			const handle = toScreen(frame, space, { x: vertex.x + tangent.x, y: vertex.y + tangent.y });
			drawHandle(frame, origin, handle);
		}
	}
}

function tintRegion(
	frame: OverlayFrame,
	space: Matrix2x3,
	network: VectorNetwork,
	regionIndex: number
): void {
	const region = network.regions?.[regionIndex];
	if (!region) return;
	const { ctx } = frame;
	ctx.fillStyle = 'rgba(13, 153, 255, 0.25)';
	ctx.beginPath();
	for (const loop of region.loops) {
		let first = true;
		for (const index of loop) {
			const segment = network.segments[index];
			if (!validSegment(network, segment)) continue;
			const controls = segmentControls(network, segment);
			const start = toScreen(frame, space, controls.start);
			if (first) ctx.moveTo(start.x, start.y);
			first = false;
			const a = toScreen(frame, space, controls.firstControl);
			const b = toScreen(frame, space, controls.secondControl);
			const end = toScreen(frame, space, controls.end);
			ctx.bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y);
		}
		ctx.closePath();
	}
	ctx.fill('evenodd');
}

/** Draws `network` (in the space `space` maps to world) with its points and handles. */
export function drawNetworkOverlay(
	frame: OverlayFrame,
	space: Matrix2x3,
	network: VectorNetwork,
	options: NetworkDrawOptions = {}
): void {
	const { ctx } = frame;
	if (options.highlightRegion !== undefined) {
		tintRegion(frame, space, network, options.highlightRegion);
	}
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = 1.5;
	network.segments.forEach((segment, index) => {
		if (!validSegment(network, segment)) return;
		const selected = options.selectedSegments?.has(index) === true;
		const hovered = options.hoverSegment === index;
		ctx.lineWidth = selected || hovered ? 3 : 1.5;
		strokeSegment(frame, space, network, index);
	});
	const handleVertices = options.handleVertices ?? network.vertices.keys();
	drawHandles(frame, space, network, handleVertices);
	if (options.showPoints === false) return;
	network.vertices.forEach((vertex, index) => {
		const selected = options.selectedVertices?.has(index) === true;
		drawPoint(frame, toScreen(frame, space, vertex), selected, options.hoverVertex === index);
	});
}
