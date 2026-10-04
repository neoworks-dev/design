// Node outlines as plain path commands: the geometry every renderer backend draws, produced from
// stored node properties alone (no Skia, no kernel). Coordinates are in the node's local space,
// origin at its top-left corner. The vector network to path conversion lives here too
// (issue #34: "vector network to SkPath conversion lives in the pure document lib").

import type { SceneNode, VectorNetwork, VectorSegment } from './types';

export type PathCommand =
	| { op: 'move'; x: number; y: number }
	| { op: 'line'; x: number; y: number }
	| { op: 'cubic'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	/** Circular or elliptical arc of at most a quarter turn, from the current point to (x, y). */
	| { op: 'arc'; radiusX: number; radiusY: number; clockwise: boolean; x: number; y: number }
	| { op: 'close' };

export type FillRule = 'NONZERO' | 'EVENODD';

export interface Outline {
	/** What fills cover; empty for shapes that cannot be filled (a line, an open vector). */
	fill: PathCommand[];
	/** What strokes follow; the same array as `fill` for closed shapes. */
	stroke: PathCommand[];
	/** True when the shape has an inside, so inside/outside stroke alignment is meaningful. */
	closed: boolean;
	fillRule: FillRule;
}

/** Top-left, top-right, bottom-right, bottom-left. */
export type CornerRadii = [number, number, number, number];

export function cornerRadiiOf(cornerRadius: number | CornerRadii): CornerRadii {
	if (typeof cornerRadius === 'number') {
		return [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
	}
	return cornerRadius;
}

interface Vector2 {
	x: number;
	y: number;
}

function scaled(vector: Vector2, factor: number): Vector2 {
	return { x: vector.x * factor, y: vector.y * factor };
}

function plus(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function minus(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function lengthOf(vector: Vector2): number {
	return Math.hypot(vector.x, vector.y);
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function closedOutline(commands: PathCommand[]): Outline {
	return { fill: commands, stroke: commands, closed: true, fillRule: 'NONZERO' };
}

// ---------- rectangles with per-corner radius and smoothing ----------

interface SmoothCorner {
	radius: number;
	/** Distance the curve starts from the corner point along each edge. */
	reach: number;
	a: number;
	b: number;
	c: number;
	d: number;
	arcSection: number;
}

/**
 * Corner geometry after Figma's "corner smoothing" (the continuous-curvature squircle corner):
 * the arc shrinks and two cubic easing curves lead into it. Smoothing 0 is a plain quarter circle.
 */
function smoothCorner(radius: number, smoothing: number, budget: number): SmoothCorner {
	const clampedSmoothing = Math.min(smoothing, budget / radius - 1);
	const reach = Math.min((1 + smoothing) * radius, budget);
	const arcMeasure = 90 * (1 - clampedSmoothing);
	const arcSection = Math.sin(degreesToRadians(arcMeasure / 2)) * radius * Math.SQRT2;
	const angleAlpha = (90 - arcMeasure) / 2;
	const tangentDistance = radius * Math.tan(degreesToRadians(angleAlpha / 2));
	const angleBeta = 45 * clampedSmoothing;
	const c = tangentDistance * Math.cos(degreesToRadians(angleBeta));
	const d = c * Math.tan(degreesToRadians(angleBeta));
	const b = (reach - arcSection - c - d) / 3;
	return { radius, reach, a: 2 * b, b, c, d, arcSection };
}

interface CornerFrame {
	point: Vector2;
	/** Direction of travel along the edge arriving at the corner (clockwise walk). */
	incoming: Vector2;
	/** Direction of travel along the edge leaving the corner. */
	outgoing: Vector2;
}

function cornerFrames(width: number, height: number): CornerFrame[] {
	return [
		{ point: { x: width, y: 0 }, incoming: { x: 1, y: 0 }, outgoing: { x: 0, y: 1 } },
		{ point: { x: width, y: height }, incoming: { x: 0, y: 1 }, outgoing: { x: -1, y: 0 } },
		{ point: { x: 0, y: height }, incoming: { x: -1, y: 0 }, outgoing: { x: 0, y: -1 } },
		{ point: { x: 0, y: 0 }, incoming: { x: 0, y: -1 }, outgoing: { x: 1, y: 0 } }
	];
}

function along(
	start: Vector2,
	incoming: Vector2,
	outgoing: Vector2,
	u: number,
	v: number
): Vector2 {
	return plus(start, plus(scaled(incoming, u), scaled(outgoing, v)));
}

function cornerCommands(
	frame: CornerFrame,
	corner: SmoothCorner,
	draw: PathCommand[],
	smoothing: number
): void {
	const { incoming, outgoing } = frame;
	const start = minus(frame.point, scaled(incoming, corner.reach));
	pushLineOrMove(draw, start);
	const { a, b, c, d, arcSection, radius } = corner;
	if (smoothing > 0) {
		const first = along(start, incoming, outgoing, a, 0);
		const second = along(start, incoming, outgoing, a + b, 0);
		const end = along(start, incoming, outgoing, a + b + c, d);
		draw.push({
			op: 'cubic',
			x1: first.x,
			y1: first.y,
			x2: second.x,
			y2: second.y,
			x: end.x,
			y: end.y
		});
		const arcEnd = along(end, incoming, outgoing, arcSection, arcSection);
		draw.push({
			op: 'arc',
			radiusX: radius,
			radiusY: radius,
			clockwise: true,
			x: arcEnd.x,
			y: arcEnd.y
		});
		const third = along(arcEnd, incoming, outgoing, d, c);
		const fourth = along(arcEnd, incoming, outgoing, d, b + c);
		const last = along(arcEnd, incoming, outgoing, d, a + b + c);
		draw.push({
			op: 'cubic',
			x1: third.x,
			y1: third.y,
			x2: fourth.x,
			y2: fourth.y,
			x: last.x,
			y: last.y
		});
		return;
	}
	const arcEnd = along(start, incoming, outgoing, radius, radius);
	draw.push({
		op: 'arc',
		radiusX: radius,
		radiusY: radius,
		clockwise: true,
		x: arcEnd.x,
		y: arcEnd.y
	});
}

function pushLineOrMove(commands: PathCommand[], point: Vector2): void {
	if (commands.length === 0) {
		commands.push({ op: 'move', x: point.x, y: point.y });
		return;
	}
	commands.push({ op: 'line', x: point.x, y: point.y });
}

/** A closed rectangle at (x, y); radii are clamped so opposite corners never overlap. */
export function roundedRectangleCommands(
	x: number,
	y: number,
	width: number,
	height: number,
	cornerRadius: number | CornerRadii,
	cornerSmoothing = 0
): PathCommand[] {
	const budget = Math.min(width, height) / 2;
	const radii = cornerRadiiOf(cornerRadius);
	const frames = cornerFrames(width, height);
	const draw: PathCommand[] = [];
	for (let index = 0; index < 4; index += 1) {
		const radius = Math.min(Math.max(radii[(index + 1) % 4], 0), budget);
		if (radius <= 0) {
			pushLineOrMove(draw, frames[index].point);
			continue;
		}
		cornerCommands(
			frames[index],
			smoothCorner(radius, cornerSmoothing, budget),
			draw,
			cornerSmoothing
		);
	}
	draw.push({ op: 'close' });
	return translatedCommands(draw, x, y);
}

function translatedCommands(commands: PathCommand[], dx: number, dy: number): PathCommand[] {
	if (dx === 0 && dy === 0) return commands;
	return commands.map((command): PathCommand => {
		if (command.op === 'close') return command;
		if (command.op === 'cubic') {
			return {
				...command,
				x1: command.x1 + dx,
				y1: command.y1 + dy,
				x2: command.x2 + dx,
				y2: command.y2 + dy,
				x: command.x + dx,
				y: command.y + dy
			};
		}
		return { ...command, x: command.x + dx, y: command.y + dy };
	});
}

// ---------- ellipses, arcs and rings ----------

const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;

function ellipsePoint(width: number, height: number, radiusScale: number, angle: number): Vector2 {
	return {
		x: width / 2 + (width / 2) * radiusScale * Math.cos(angle),
		y: height / 2 + (height / 2) * radiusScale * Math.sin(angle)
	};
}

function arcCommands(
	width: number,
	height: number,
	radiusScale: number,
	startAngle: number,
	sweep: number
): PathCommand[] {
	const commands: PathCommand[] = [];
	const steps = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER_TURN - 1e-9));
	const clockwise = sweep >= 0;
	for (let step = 1; step <= steps; step += 1) {
		const end = ellipsePoint(width, height, radiusScale, startAngle + (sweep * step) / steps);
		commands.push({
			op: 'arc',
			radiusX: (width / 2) * radiusScale,
			radiusY: (height / 2) * radiusScale,
			clockwise,
			x: end.x,
			y: end.y
		});
	}
	return commands;
}

function ellipseOutline(
	width: number,
	height: number,
	arc: { startingAngle: number; endingAngle: number; innerRadius: number }
): Outline {
	let sweep = arc.endingAngle - arc.startingAngle;
	while (sweep < 0) sweep += FULL_TURN;
	const isFullTurn = sweep >= FULL_TURN - 1e-6;
	if (isFullTurn) sweep = FULL_TURN;
	const start = arc.startingAngle;
	const outerStart = ellipsePoint(width, height, 1, start);
	const commands: PathCommand[] = [{ op: 'move', x: outerStart.x, y: outerStart.y }];
	commands.push(...arcCommands(width, height, 1, start, sweep));
	const hasHole = arc.innerRadius > 0;
	if (isFullTurn) {
		commands.push({ op: 'close' });
		if (hasHole) commands.push(...innerContour(width, height, arc.innerRadius, start, sweep));
		return closedOutline(commands);
	}
	if (hasHole) {
		const innerEnd = ellipsePoint(width, height, arc.innerRadius, start + sweep);
		commands.push({ op: 'line', x: innerEnd.x, y: innerEnd.y });
		commands.push(...arcCommands(width, height, arc.innerRadius, start + sweep, -sweep));
	} else {
		commands.push({ op: 'line', x: width / 2, y: height / 2 });
	}
	commands.push({ op: 'close' });
	return closedOutline(commands);
}

function innerContour(
	width: number,
	height: number,
	innerRadius: number,
	start: number,
	sweep: number
): PathCommand[] {
	const first = ellipsePoint(width, height, innerRadius, start);
	return [
		{ op: 'move', x: first.x, y: first.y },
		...arcCommands(width, height, innerRadius, start, -sweep),
		{ op: 'close' }
	];
}

// ---------- polygons and stars ----------

function polygonVertices(width: number, height: number, count: number): Vector2[] {
	const vertices: Vector2[] = [];
	for (let index = 0; index < count; index += 1) {
		const angle = -QUARTER_TURN + (FULL_TURN * index) / count;
		vertices.push(ellipsePoint(width, height, 1, angle));
	}
	return vertices;
}

function starVertices(
	width: number,
	height: number,
	count: number,
	innerRadius: number
): Vector2[] {
	const vertices: Vector2[] = [];
	for (let index = 0; index < count * 2; index += 1) {
		const angle = -QUARTER_TURN + (Math.PI * index) / count;
		let radiusScale = 1;
		if (index % 2 === 1) radiusScale = innerRadius;
		vertices.push(ellipsePoint(width, height, radiusScale, angle));
	}
	return vertices;
}

function roundedPolygonCommands(vertices: Vector2[], radius: number): PathCommand[] {
	const commands: PathCommand[] = [];
	const count = vertices.length;
	for (let index = 0; index < count; index += 1) {
		const previous = vertices[(index + count - 1) % count];
		const vertex = vertices[index];
		const next = vertices[(index + 1) % count];
		appendRoundedVertex(commands, previous, vertex, next, radius);
	}
	commands.push({ op: 'close' });
	return commands;
}

function appendRoundedVertex(
	commands: PathCommand[],
	previous: Vector2,
	vertex: Vector2,
	next: Vector2,
	radius: number
): void {
	const toPrevious = minus(previous, vertex);
	const toNext = minus(next, vertex);
	const previousLength = lengthOf(toPrevious);
	const nextLength = lengthOf(toNext);
	const cosine =
		(toPrevious.x * toNext.x + toPrevious.y * toNext.y) / (previousLength * nextLength);
	const interiorAngle = Math.acos(Math.min(1, Math.max(-1, cosine)));
	const tangentLength = Math.min(
		radius / Math.tan(interiorAngle / 2),
		previousLength / 2,
		nextLength / 2
	);
	if (radius <= 0 || !Number.isFinite(tangentLength) || tangentLength <= 0) {
		pushLineOrMove(commands, vertex);
		return;
	}
	const entry = plus(vertex, scaled(toPrevious, tangentLength / previousLength));
	const exit = plus(vertex, scaled(toNext, tangentLength / nextLength));
	const actualRadius = tangentLength * Math.tan(interiorAngle / 2);
	const turn =
		(vertex.x - previous.x) * (next.y - vertex.y) - (vertex.y - previous.y) * (next.x - vertex.x);
	pushLineOrMove(commands, entry);
	commands.push({
		op: 'arc',
		radiusX: actualRadius,
		radiusY: actualRadius,
		clockwise: turn > 0,
		x: exit.x,
		y: exit.y
	});
}

function uniformRadius(cornerRadius: number | CornerRadii): number {
	return cornerRadiiOf(cornerRadius)[0];
}

// ---------- vector networks ----------

function tangentOrZero(tangent: Vector2 | undefined): Vector2 {
	if (tangent) return tangent;
	return { x: 0, y: 0 };
}

function segmentCommands(
	network: VectorNetwork,
	segment: VectorSegment,
	reversed: boolean
): PathCommand {
	const from = network.vertices[reversed ? segment.end : segment.start];
	const to = network.vertices[reversed ? segment.start : segment.end];
	const fromTangent = reversed ? segment.tangentEnd : segment.tangentStart;
	const toTangent = reversed ? segment.tangentStart : segment.tangentEnd;
	if (!fromTangent && !toTangent) return { op: 'line', x: to.x, y: to.y };
	const first = plus(from, tangentOrZero(fromTangent));
	const second = plus(to, tangentOrZero(toTangent));
	return { op: 'cubic', x1: first.x, y1: first.y, x2: second.x, y2: second.y, x: to.x, y: to.y };
}

function validSegment(network: VectorNetwork, segment: VectorSegment | undefined): boolean {
	if (!segment) return false;
	return (
		network.vertices[segment.start] !== undefined && network.vertices[segment.end] !== undefined
	);
}

/** Every segment as a stroke, continuing the current subpath while segments chain end to start. */
function networkStrokeCommands(network: VectorNetwork): PathCommand[] {
	const commands: PathCommand[] = [];
	let currentVertex = -1;
	for (const segment of network.segments) {
		if (!validSegment(network, segment)) continue;
		if (segment.start !== currentVertex) {
			const start = network.vertices[segment.start];
			commands.push({ op: 'move', x: start.x, y: start.y });
		}
		commands.push(segmentCommands(network, segment, false));
		currentVertex = segment.end;
	}
	return commands;
}

function loopIsForward(
	network: VectorNetwork,
	loop: number[],
	position: number,
	vertex: number
): boolean {
	const segment = network.segments[loop[position]];
	if (vertex !== -1) return segment.start === vertex;
	if (loop.length < 2) return true;
	const following = network.segments[loop[(position + 1) % loop.length]];
	return segment.end === following.start || segment.end === following.end;
}

function loopCommands(network: VectorNetwork, loop: number[]): PathCommand[] {
	const commands: PathCommand[] = [];
	let currentVertex = -1;
	for (let position = 0; position < loop.length; position += 1) {
		const segment = network.segments[loop[position]];
		if (!validSegment(network, segment)) continue;
		const forward = loopIsForward(network, loop, position, currentVertex);
		if (currentVertex === -1) {
			const start = network.vertices[forward ? segment.start : segment.end];
			commands.push({ op: 'move', x: start.x, y: start.y });
		}
		commands.push(segmentCommands(network, segment, !forward));
		currentVertex = forward ? segment.end : segment.start;
	}
	if (commands.length > 0) commands.push({ op: 'close' });
	return commands;
}

export function vectorNetworkOutline(network: VectorNetwork): Outline {
	const stroke = networkStrokeCommands(network);
	const regions = network.regions ?? [];
	const fill: PathCommand[] = [];
	let fillRule: FillRule = 'NONZERO';
	for (const region of regions) {
		if (region.windingRule === 'EVENODD') fillRule = 'EVENODD';
		for (const loop of region.loops) fill.push(...loopCommands(network, loop));
	}
	return { fill, stroke, closed: fill.length > 0, fillRule };
}

// ---------- entry point ----------

/**
 * The outline of a node's own geometry (not its children), or null for nodes that have none:
 * pages, groups, text, slices and boolean operations draw through other paths.
 */
export function nodeOutline(node: SceneNode): Outline | null {
	switch (node.type) {
		case 'FRAME':
		case 'COMPONENT':
		case 'COMPONENT_SET':
		case 'INSTANCE':
		case 'RECTANGLE':
			return closedOutline(
				roundedRectangleCommands(
					0,
					0,
					node.width,
					node.height,
					node.cornerRadius,
					node.cornerSmoothing
				)
			);
		case 'SECTION':
			return closedOutline(roundedRectangleCommands(0, 0, node.width, node.height, 0));
		case 'ELLIPSE':
			return ellipseOutline(node.width, node.height, node.arcData);
		case 'POLYGON':
			return closedOutline(
				roundedPolygonCommands(
					polygonVertices(node.width, node.height, node.pointCount),
					uniformRadius(node.cornerRadius)
				)
			);
		case 'STAR':
			return closedOutline(
				roundedPolygonCommands(
					starVertices(node.width, node.height, node.pointCount, node.innerRadius),
					uniformRadius(node.cornerRadius)
				)
			);
		case 'LINE': {
			const commands: PathCommand[] = [
				{ op: 'move', x: 0, y: 0 },
				{ op: 'line', x: node.width, y: 0 }
			];
			return { fill: [], stroke: commands, closed: false, fillRule: 'NONZERO' };
		}
		case 'VECTOR':
			return vectorNetworkOutline(node.network);
		default:
			return null;
	}
}
