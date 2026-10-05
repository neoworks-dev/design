// Analytic geometry of nodes in their local space (box (0, 0, width, height)): signed distance
// to the outline, stroke extents and the render-bounds outset. Pure; used by the hit tester and
// by the spatial index.
//
// Exact today: rectangles and frames (per-corner radii), ellipses, lines and vector networks. Everything else
// (polygon, star, text, boolean operation, slice) answers with its bounding box until its
// geometry exists (text layout, boolean results): see `geometryKind`.

import { expandCornerRadii } from '../vector/cornerRadius';
import { networkSignedDistance } from '../vector/geometry';
import type { Effect, Node, Stroke, StrokeWeights } from './types';

export type GeometryKind = 'rounded-rect' | 'ellipse' | 'line' | 'vector' | 'box' | 'none';

export function geometryKind(node: Node): GeometryKind {
	switch (node.type) {
		case 'FRAME':
		case 'SECTION':
		case 'RECTANGLE':
		case 'COMPONENT':
		case 'COMPONENT_SET':
		case 'INSTANCE':
			return 'rounded-rect';
		case 'ELLIPSE':
			return 'ellipse';
		case 'LINE':
			return 'line';
		case 'VECTOR':
			return 'vector';
		case 'PAGE':
		case 'GROUP':
			return 'none';
		default:
			return 'box';
	}
}

/** Node types whose area is clickable "background": frames and the like. */
export function isFrameLike(node: Node): boolean {
	return (
		node.type === 'FRAME' ||
		node.type === 'SECTION' ||
		node.type === 'COMPONENT' ||
		node.type === 'COMPONENT_SET' ||
		node.type === 'INSTANCE'
	);
}

export function nodeStrokes(node: Node): readonly Stroke[] {
	if (!('strokes' in node)) return [];
	return node.strokes;
}

export function nodeEffects(node: Node): readonly Effect[] {
	if (!('effects' in node)) return [];
	return node.effects;
}

export function hasVisibleFill(node: Node): boolean {
	if (!('fills' in node)) return false;
	return node.fills.some((paint) => paint.visible);
}

function maxWeight(weight: number | StrokeWeights): number {
	if (typeof weight === 'number') return weight;
	return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

export interface StrokeExtent {
	/** How far the stroke reaches into the shape. */
	inner: number;
	/** How far it reaches out of the shape. */
	outer: number;
}

/** Union of all painted strokes of `node`; zero extent when it has none. */
export function strokeExtent(node: Node): StrokeExtent {
	const extent = { inner: 0, outer: 0 };
	for (const stroke of nodeStrokes(node)) {
		if (!stroke.paints.some((paint) => paint.visible)) continue;
		const weight = maxWeight(stroke.weight);
		if (weight <= 0) continue;
		if (stroke.align === 'INSIDE') extent.inner = Math.max(extent.inner, weight);
		if (stroke.align === 'OUTSIDE') extent.outer = Math.max(extent.outer, weight);
		if (stroke.align === 'CENTER') {
			extent.inner = Math.max(extent.inner, weight / 2);
			extent.outer = Math.max(extent.outer, weight / 2);
		}
	}
	return extent;
}

/** How far visible shadows and blurs reach past the shape, in page units. */
export function effectOutset(node: Node): number {
	let outset = 0;
	for (const effect of nodeEffects(node)) {
		if (!effect.visible) continue;
		if (effect.type === 'DROP_SHADOW') {
			const reach = Math.hypot(effect.offset.x, effect.offset.y) + effect.radius;
			outset = Math.max(outset, reach + Math.max(effect.spread, 0));
		}
		if (effect.type === 'LAYER_BLUR') outset = Math.max(outset, effect.radius * 2);
	}
	return outset;
}

function cornerRadii(node: Node, width: number, height: number): number[] {
	if (!('cornerRadius' in node)) return [0, 0, 0, 0];
	const limit = Math.min(width, height) / 2;
	const radius = node.cornerRadius;
	const radii = typeof radius === 'number' ? [radius, radius, radius, radius] : radius;
	return radii.map((value) => Math.max(0, Math.min(value, limit)));
}

function roundedRectDistance(
	radii: number[],
	width: number,
	height: number,
	x: number,
	y: number
): number {
	const centreX = x - width / 2;
	const centreY = y - height / 2;
	// Radii order: top-left, top-right, bottom-right, bottom-left.
	let radius = centreX < 0 ? radii[3] : radii[2];
	if (centreY < 0) radius = centreX < 0 ? radii[0] : radii[1];
	const qx = Math.abs(centreX) - width / 2 + radius;
	const qy = Math.abs(centreY) - height / 2 + radius;
	const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
	return Math.min(Math.max(qx, qy), 0) + outside - radius;
}

function ellipseDistance(width: number, height: number, x: number, y: number): number {
	const radiusX = width / 2;
	const radiusY = height / 2;
	if (radiusX === 0 || radiusY === 0) return Math.hypot(x - radiusX, y - radiusY);
	const px = x - radiusX;
	const py = y - radiusY;
	const scaledLength = Math.hypot(px / radiusX, py / radiusY);
	const gradientLength = Math.hypot(px / (radiusX * radiusX), py / (radiusY * radiusY));
	if (gradientLength === 0) return -Math.min(radiusX, radiusY);
	// First-order distance estimate: exact on the outline, close nearby.
	return (scaledLength * (scaledLength - 1)) / gradientLength;
}

function segmentDistance(width: number, x: number, y: number): number {
	const clampedX = Math.max(0, Math.min(width, x));
	return Math.hypot(x - clampedX, y);
}

/**
 * Signed distance from the local point to the node's outline: negative inside, zero on the
 * outline. For a line it is the distance to the segment (never negative). `undefined` when the
 * node has no geometry of its own (groups, pages).
 */
export function signedDistance(node: Node, localX: number, localY: number): number | undefined {
	if (node.type === 'PAGE') return undefined;
	const { width, height } = node;
	switch (geometryKind(node)) {
		case 'rounded-rect':
			return roundedRectDistance(cornerRadii(node, width, height), width, height, localX, localY);
		case 'ellipse':
			return ellipseDistance(width, height, localX, localY);
		case 'line':
			return segmentDistance(width, localX, localY);
		case 'vector':
			if (node.type !== 'VECTOR') return undefined;
			return networkSignedDistance(expandCornerRadii(node.network), { x: localX, y: localY });
		case 'box':
			return roundedRectDistance([0, 0, 0, 0], width, height, localX, localY);
		case 'none':
			return undefined;
	}
}
