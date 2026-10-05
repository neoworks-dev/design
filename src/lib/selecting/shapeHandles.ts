// Direct-manipulation handles specific to a shape type (docs/research/interactions.md section 4):
// corner radius, ellipse arcs, polygon and star points. Pure: given a node and the screen scale
// it says where the handles are (in the node's local space) and which properties a drag sets.

import type { CornerRadii, Node } from '../document';
import { cornerRadiiOf } from '../document';
import type { Point } from '../tools/protocol';

export type ShapeHandleKind =
	'radius' | 'arcStart' | 'arcEnd' | 'arcInner' | 'pointCount' | 'starInner';

export interface ShapeHandle {
	id: string;
	kind: ShapeHandleKind;
	/** 0 top left, 1 top right, 2 bottom right, 3 bottom left; only for `radius` handles. */
	corner: number;
	/** Position in the node's local space. */
	local: Point;
}

export interface HandleModifiers {
	altKey: boolean;
	shiftKey: boolean;
}

/** Handles hide when the shape is smaller than this on screen (pixels, shorter side). */
export const MIN_SCREEN_SIZE = 48;
/** How far a radius handle sits from its corner when the radius is zero (pixels). */
export const RADIUS_HANDLE_INSET = 14;
const PIXELS_PER_POINT = 18;
const MIN_POINTS = 3;
const MAX_POINTS = 60;
const MIN_INNER_RATIO = 0.01;
const MAX_INNER_RATIO = 0.99;
const FULL_TURN = Math.PI * 2;
const SNAP_STEP = Math.PI / 12;

export type HandledNode = Extract<
	Node,
	{ type: 'RECTANGLE' | 'FRAME' | 'COMPONENT' | 'INSTANCE' | 'POLYGON' | 'STAR' | 'ELLIPSE' }
>;

const RADIUS_TYPES: readonly string[] = ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'];

export function hasShapeHandles(node: Node): node is HandledNode {
	if (RADIUS_TYPES.includes(node.type)) return true;
	return node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR';
}

function ellipsePoint(
	node: { width: number; height: number },
	ratio: number,
	angle: number
): Point {
	return {
		x: node.width / 2 + (node.width / 2) * ratio * Math.cos(angle),
		y: node.height / 2 + (node.height / 2) * ratio * Math.sin(angle)
	};
}

/** Corner `index` and the direction pointing into the shape from it. */
function cornerGeometry(
	node: { width: number; height: number },
	index: number
): { origin: Point; inward: Point } {
	const right = index === 1 || index === 2;
	const bottom = index === 2 || index === 3;
	return {
		origin: { x: right ? node.width : 0, y: bottom ? node.height : 0 },
		inward: { x: right ? -1 : 1, y: bottom ? -1 : 1 }
	};
}

type RadiusNode = Extract<HandledNode, { cornerRadius: number | CornerRadii }>;

function radiusHandles(node: RadiusNode, pixelsPerUnit: number): ShapeHandle[] {
	const radii = cornerRadiiOf(node.cornerRadius);
	const minimumInset = RADIUS_HANDLE_INSET / pixelsPerUnit;
	const handles: ShapeHandle[] = [];
	for (let corner = 0; corner < 4; corner += 1) {
		const { origin, inward } = cornerGeometry(node, corner);
		const inset = Math.max(radii[corner], minimumInset);
		handles.push({
			id: `radius-${corner}`,
			kind: 'radius',
			corner,
			local: { x: origin.x + inward.x * inset, y: origin.y + inward.y * inset }
		});
	}
	return handles;
}

/** The polygon's radius handle rests this far below the top vertex when the radius is zero. */
function polygonRadiusBase(pixelsPerUnit: number): number {
	return (RADIUS_HANDLE_INSET * 3.5) / pixelsPerUnit;
}

function polygonHandles(
	node: Extract<HandledNode, { type: 'POLYGON' }>,
	pixelsPerUnit: number
): ShapeHandle[] {
	const radius = cornerRadiiOf(node.cornerRadius)[0];
	const y = polygonRadiusBase(pixelsPerUnit) + radius;
	return [
		{ id: 'radius-0', kind: 'radius', corner: 0, local: { x: node.width / 2, y } },
		pointCountHandle(node, pixelsPerUnit)
	];
}

/** Below the top vertex, clear of the north resize handle. */
function pointCountHandle(node: { width: number }, pixelsPerUnit: number): ShapeHandle {
	const inset = (RADIUS_HANDLE_INSET * 1.7) / pixelsPerUnit;
	return { id: 'points', kind: 'pointCount', corner: 0, local: { x: node.width / 2, y: inset } };
}

function starHandles(
	node: Extract<HandledNode, { type: 'STAR' }>,
	pixelsPerUnit: number
): ShapeHandle[] {
	const innerAngle = -Math.PI / 2 + Math.PI / node.pointCount;
	return [
		pointCountHandle(node, pixelsPerUnit),
		{
			id: 'inner',
			kind: 'starInner',
			corner: 0,
			local: ellipsePoint(node, node.innerRadius, innerAngle)
		}
	];
}

function ellipseHandles(
	node: Extract<HandledNode, { type: 'ELLIPSE' }>,
	pixelsPerUnit: number
): ShapeHandle[] {
	const { startingAngle, endingAngle, innerRadius } = node.arcData;
	const shortSide = Math.min(node.width, node.height);
	const endInset = Math.min(0.4, RADIUS_HANDLE_INSET / (pixelsPerUnit * (shortSide / 2)));
	return [
		{ id: 'arc-start', kind: 'arcStart', corner: 0, local: ellipsePoint(node, 1, startingAngle) },
		{
			id: 'arc-end',
			kind: 'arcEnd',
			corner: 0,
			local: ellipsePoint(node, 1 - endInset, endingAngle)
		},
		{
			id: 'arc-inner',
			kind: 'arcInner',
			corner: 0,
			local: ellipsePoint(node, Math.max(innerRadius, 0.12), startingAngle)
		}
	];
}

/** Handles for `node` at `pixelsPerUnit` screen pixels per local unit; none when too small. */
export function shapeHandles(node: Node, pixelsPerUnit: number): ShapeHandle[] {
	if (!hasShapeHandles(node) || node.locked) return [];
	if (Math.min(node.width, node.height) * pixelsPerUnit < MIN_SCREEN_SIZE) return [];
	if (node.type === 'ELLIPSE') return ellipseHandles(node, pixelsPerUnit);
	if (node.type === 'POLYGON') return polygonHandles(node, pixelsPerUnit);
	if (node.type === 'STAR') return starHandles(node, pixelsPerUnit);
	return radiusHandles(node, pixelsPerUnit);
}

function hasCornerRadius(node: HandledNode): node is RadiusNode {
	return node.type !== 'ELLIPSE';
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** Angle of a local point as seen from the centre of the (possibly stretched) ellipse. */
function ellipseAngle(node: { width: number; height: number }, point: Point): number {
	const angle = Math.atan2(
		(point.y - node.height / 2) / (node.height / 2),
		(point.x - node.width / 2) / (node.width / 2)
	);
	if (angle < 0) return angle + FULL_TURN;
	return angle;
}

function snapAngle(angle: number, modifiers: HandleModifiers): number {
	if (!modifiers.shiftKey) return angle;
	return Math.round(angle / SNAP_STEP) * SNAP_STEP;
}

function radiusProps(
	node: RadiusNode,
	handle: ShapeHandle,
	pointer: Point,
	modifiers: HandleModifiers,
	pixelsPerUnit: number
): Record<string, unknown> {
	const maximum = Math.min(node.width, node.height) / 2;
	if (node.type === 'POLYGON') {
		const reach = pointer.y - polygonRadiusBase(pixelsPerUnit);
		return { cornerRadius: Math.round(clamp(reach, 0, maximum) * 100) / 100 };
	}
	const { origin, inward } = cornerGeometry(node, handle.corner);
	const reach = ((pointer.x - origin.x) * inward.x + (pointer.y - origin.y) * inward.y) / 2;
	const radius = Math.round(clamp(reach, 0, maximum) * 100) / 100;
	if (!modifiers.altKey) return { cornerRadius: radius };
	const radii: CornerRadii = [...cornerRadiiOf(node.cornerRadius)];
	radii[handle.corner] = radius;
	return { cornerRadius: radii };
}

/**
 * The property changes a drag of `handle` produces, computed from the node as it was when the
 * drag started and the pointer in the node's local space.
 */
export function dragShapeHandle(
	node: HandledNode,
	handle: ShapeHandle,
	pointer: Point,
	modifiers: HandleModifiers,
	scale: { pointerAtStart: Point; pixelsPerUnit: number }
): Record<string, unknown> {
	if (handle.kind === 'radius' && hasCornerRadius(node)) {
		return radiusProps(node, handle, pointer, modifiers, scale.pixelsPerUnit);
	}
	if (node.type === 'ELLIPSE') return arcProps(node, handle, pointer, modifiers);
	if (handle.kind === 'pointCount' && 'pointCount' in node) {
		const moved = ((pointer.x - scale.pointerAtStart.x) * scale.pixelsPerUnit) / PIXELS_PER_POINT;
		return { pointCount: clamp(Math.round(node.pointCount + moved), MIN_POINTS, MAX_POINTS) };
	}
	if (handle.kind === 'starInner' && node.type === 'STAR') {
		const distance = Math.hypot(
			(pointer.x - node.width / 2) / (node.width / 2),
			(pointer.y - node.height / 2) / (node.height / 2)
		);
		const innerRadius = clamp(distance, MIN_INNER_RATIO, MAX_INNER_RATIO);
		return { innerRadius: Math.round(innerRadius * 1000) / 1000 };
	}
	return {};
}

function arcProps(
	node: Extract<HandledNode, { type: 'ELLIPSE' }>,
	handle: ShapeHandle,
	pointer: Point,
	modifiers: HandleModifiers
): Record<string, unknown> {
	const arc = node.arcData;
	if (handle.kind === 'arcStart') {
		const startingAngle = snapAngle(ellipseAngle(node, pointer), modifiers);
		return { arcData: { ...arc, startingAngle } };
	}
	if (handle.kind === 'arcEnd') {
		const endingAngle = snapAngle(ellipseAngle(node, pointer), modifiers);
		return { arcData: { ...arc, endingAngle } };
	}
	const distance = Math.hypot(
		(pointer.x - node.width / 2) / (node.width / 2),
		(pointer.y - node.height / 2) / (node.height / 2)
	);
	return { arcData: { ...arc, innerRadius: clamp(distance, 0, MAX_INNER_RATIO) } };
}

/** Number shown next to the pointer while a handle is dragged. */
export function handleReadout(node: HandledNode, handle: ShapeHandle): string {
	if (handle.kind === 'radius' && hasCornerRadius(node)) {
		return String(Math.round(cornerRadiiOf(node.cornerRadius)[handle.corner]));
	}
	if (node.type === 'ELLIPSE') return ellipseReadout(node, handle);
	if (handle.kind === 'pointCount' && 'pointCount' in node) return `${node.pointCount} points`;
	if (node.type === 'STAR') return `${Math.round(node.innerRadius * 100)}%`;
	return '';
}

function ellipseReadout(
	node: Extract<HandledNode, { type: 'ELLIPSE' }>,
	handle: ShapeHandle
): string {
	const arc = node.arcData;
	if (handle.kind === 'arcInner') return `${Math.round(arc.innerRadius * 100)}%`;
	let sweep = arc.endingAngle - arc.startingAngle;
	while (sweep < 0) sweep += FULL_TURN;
	if (handle.kind === 'arcStart') return `${Math.round((arc.startingAngle * 180) / Math.PI)}°`;
	return `${Math.round((sweep * 180) / Math.PI)}°`;
}
