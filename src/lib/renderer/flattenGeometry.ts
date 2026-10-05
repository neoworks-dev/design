// Geometry for Flatten and Outline stroke (#103): a node's shape, boolean result, group union or
// stroke area as a vector network in the node's local space. Arcs, quads and conics come back as
// cubics through Skia paths (the same route booleans take), so the network only has lines and
// cubics. Everything Skia allocates is deleted before a function returns.

import type { CanvasKit, Path, StrokeCap, StrokeJoin } from 'canvaskit-wasm';
import { nodeOutline } from '../document/outline';
import type { SceneNode, Stroke, VectorNetwork } from '../document/types';
import { commandsToNetwork } from '../vector/fromCommands';
import {
	booleanResultPath,
	localPath as nodeLocalPath,
	pathFillRule,
	pathToCommands,
	type OperandSource,
	type Own
} from './booleanOps';
import { pathFromCommands } from './draw/skiaPath';
import type { Deletable } from './ownership';

function withTemporaries<T>(run: (own: Own) => T): T {
	const temporaries: Deletable[] = [];
	try {
		return run((object) => {
			temporaries.push(object);
			return object;
		});
	} finally {
		while (temporaries.length > 0) temporaries.pop()?.delete();
	}
}

function networkOf(kit: CanvasKit, path: Path): VectorNetwork | null {
	const network = commandsToNetwork(pathToCommands(kit, path), pathFillRule(kit, path));
	if (network.vertices.length === 0) return null;
	return network;
}

/** A shape's own outline: its fill area, or its open centre line when it has no inside. */
export function shapeNetwork(kit: CanvasKit, node: SceneNode): VectorNetwork | null {
	const outline = nodeOutline(node);
	if (!outline) return null;
	let commands = outline.fill;
	if (commands.length === 0) commands = outline.stroke;
	if (commands.length === 0) return null;
	return withTemporaries((own) =>
		networkOf(kit, own(pathFromCommands(kit, commands, outline.fillRule)))
	);
}

/** The result of a boolean node. */
export function booleanNetwork(
	kit: CanvasKit,
	source: OperandSource,
	node: SceneNode
): VectorNetwork | null {
	if (node.type !== 'BOOLEAN_OPERATION') return null;
	return withTemporaries((own) => {
		const path = booleanResultPath(kit, source, node, own);
		if (!path) return null;
		return networkOf(kit, path);
	});
}

/** The union of everything a group holds. */
export function groupNetwork(
	kit: CanvasKit,
	source: OperandSource,
	node: SceneNode
): VectorNetwork | null {
	if (node.type !== 'GROUP') return null;
	return withTemporaries((own) => {
		const path = nodeLocalPath(kit, source, node, own);
		if (!path) return null;
		return networkOf(kit, path);
	});
}

function uniformWeight(stroke: Stroke): number {
	if (typeof stroke.weight === 'number') return stroke.weight;
	const { top, right, bottom, left } = stroke.weight;
	return Math.max(top, right, bottom, left);
}

function capOf(kit: CanvasKit, stroke: Stroke): StrokeCap {
	if (stroke.cap === 'ROUND') return kit.StrokeCap.Round;
	if (stroke.cap === 'SQUARE') return kit.StrokeCap.Square;
	return kit.StrokeCap.Butt;
}

function joinOf(kit: CanvasKit, stroke: Stroke): StrokeJoin {
	if (stroke.join === 'ROUND') return kit.StrokeJoin.Round;
	if (stroke.join === 'BEVEL') return kit.StrokeJoin.Bevel;
	return kit.StrokeJoin.Miter;
}

/** Skia dashes pairs; an odd pattern repeats, as in SVG. Only the first pair is honoured. */
function dashPair(pattern: readonly number[]): [number, number] | null {
	const valid = pattern.filter((length) => Number.isFinite(length) && length >= 0);
	if (valid.every((length) => length === 0)) return null;
	if (valid.length === 1) return [valid[0], valid[0]];
	return [valid[0], valid[1]];
}

/**
 * The area `stroke` covers on `node`, as the renderer draws it: centred strokes use the weight,
 * inside and outside strokes use twice the weight clipped to the inside or outside of the shape.
 * Null when the node has no outline or the stroke has no weight.
 */
export function strokeAreaNetwork(
	kit: CanvasKit,
	node: SceneNode,
	stroke: Stroke
): VectorNetwork | null {
	const outline = nodeOutline(node);
	const weight = uniformWeight(stroke);
	if (!outline || weight <= 0 || outline.stroke.length === 0) return null;
	const inside = outline.closed && stroke.align === 'INSIDE';
	const outside = outline.closed && stroke.align === 'OUTSIDE';
	return withTemporaries((own) => {
		let centreLine = own(pathFromCommands(kit, outline.stroke, 'NONZERO'));
		const dash = dashPair(stroke.dashPattern);
		if (dash) {
			const dashed = centreLine.makeDashed(dash[0], dash[1], 0);
			if (dashed) centreLine = own(dashed);
		}
		const area = centreLine.makeStroked({
			width: inside || outside ? weight * 2 : weight,
			cap: capOf(kit, stroke),
			join: joinOf(kit, stroke),
			miter_limit: stroke.miterLimit
		});
		if (!area) return null;
		let result = own(area);
		if (inside || outside) {
			const shape = own(pathFromCommands(kit, outline.fill, outline.fillRule));
			const operation = inside ? kit.PathOp.Intersect : kit.PathOp.Difference;
			const clipped = kit.Path.MakeFromOp(result, shape, operation);
			if (!clipped) return null;
			result = own(clipped);
		}
		return networkOf(kit, result);
	});
}
