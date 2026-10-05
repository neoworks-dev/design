// Boolean operations (issue #102): the result path of a BOOLEAN_OPERATION node, computed with
// Skia PathOps from its operands (the node's children, bottom to top). The node keeps its
// operands; this is the derived geometry the renderer draws and the flatten command stores.
//
// Operands: closed shapes contribute their outline, open paths and lines their stroked outline,
// groups the union of their children, nested booleans their own result. Every operand path is
// transformed into the boolean node's local space. For SUBTRACT the bottom-most operand is the
// base and every later (higher) operand is cut out of it.

import type { CanvasKit, Path, PathOp } from 'canvaskit-wasm';
import { nodeOutline, type PathCommand } from '../document/outline';
import type { BooleanOperationNode, Node, NodeId, SceneNode } from '../document/types';
import { toCanvasKitMatrix } from './draw/matrix';
import { pathFromCommands } from './draw/skiaPath';
import type { Deletable } from './ownership';

/** Registers a temporary for deletion; the caller decides when. */
export type Own = <T extends Deletable>(object: T) => T;

/** What the operand walk reads: both the scene source and the document service fit. */
export interface OperandSource {
	getNode(id: NodeId): Node | undefined;
	children(id: NodeId): readonly NodeId[];
}

export type BooleanOperation = BooleanOperationNode['booleanOperation'];

function pathOp(kit: CanvasKit, operation: BooleanOperation): PathOp {
	switch (operation) {
		case 'UNION':
			return kit.PathOp.Union;
		case 'INTERSECT':
			return kit.PathOp.Intersect;
		case 'SUBTRACT':
			return kit.PathOp.Difference;
		case 'EXCLUDE':
			return kit.PathOp.XOR;
	}
}

/** The combined path in the node's local space, or null when it has no usable operand. */
export function booleanResultPath(
	kit: CanvasKit,
	source: OperandSource,
	node: BooleanOperationNode,
	own: Own
): Path | null {
	const operands = operandPaths(kit, source, node.id, own);
	if (operands.length === 0) return null;
	const operation = pathOp(kit, node.booleanOperation);
	let result = operands[0];
	for (const operand of operands.slice(1)) {
		const combined = kit.Path.MakeFromOp(result, operand, operation);
		if (combined) result = own(combined);
	}
	return result;
}

/** Fill rule of a path produced by PathOps: XOR comes back even-odd, the others winding. */
export function pathFillRule(kit: CanvasKit, path: Path): 'NONZERO' | 'EVENODD' {
	if (path.getFillType() === kit.FillType.EvenOdd) return 'EVENODD';
	return 'NONZERO';
}

function operandPaths(kit: CanvasKit, source: OperandSource, parentId: NodeId, own: Own): Path[] {
	const paths: Path[] = [];
	for (const id of source.children(parentId)) {
		const child = source.getNode(id);
		if (!child || child.type === 'PAGE' || child.type === 'SLICE' || !child.visible) continue;
		const path = operandPath(kit, source, child, own);
		if (path) paths.push(path);
	}
	return paths;
}

function operandPath(
	kit: CanvasKit,
	source: OperandSource,
	child: SceneNode,
	own: Own
): Path | null {
	const local = localPath(kit, source, child, own);
	if (!local) return null;
	const builder = new kit.PathBuilder(local);
	builder.transform(toCanvasKitMatrix(child.transform));
	return own(builder.detachAndDelete());
}

export function localPath(
	kit: CanvasKit,
	source: OperandSource,
	child: SceneNode,
	own: Own
): Path | null {
	if (child.type === 'BOOLEAN_OPERATION') return booleanResultPath(kit, source, child, own);
	if (child.type === 'GROUP') return unionOf(kit, operandPaths(kit, source, child.id, own), own);
	const outline = nodeOutline(child);
	if (!outline) return null;
	const filled = [
		...outline.fill,
		...(outline.regionFills ?? []).flatMap((entry) => entry.commands)
	];
	if (filled.length > 0) return own(pathFromCommands(kit, filled, outline.fillRule));
	return strokedOutline(kit, child, outline.stroke, own);
}

function unionOf(kit: CanvasKit, paths: Path[], own: Own): Path | null {
	if (paths.length === 0) return null;
	let result = paths[0];
	for (const path of paths.slice(1)) {
		const combined = kit.Path.MakeFromOp(result, path, kit.PathOp.Union);
		if (combined) result = own(combined);
	}
	return result;
}

/** An open path takes part with the area its stroke covers. */
function strokedOutline(
	kit: CanvasKit,
	node: SceneNode,
	commands: PathCommand[],
	own: Own
): Path | null {
	if (commands.length === 0 || !('strokes' in node)) return null;
	const stroke = node.strokes.find((entry) => entry.paints.some((paint) => paint.visible));
	if (!stroke) return null;
	const centerline = own(pathFromCommands(kit, commands, 'NONZERO'));
	const width = typeof stroke.weight === 'number' ? stroke.weight : stroke.weight.top;
	const outlined = centerline.makeStroked({
		width,
		cap: stroke.cap === 'ROUND' ? kit.StrokeCap.Round : kit.StrokeCap.Butt,
		join: stroke.join === 'ROUND' ? kit.StrokeJoin.Round : kit.StrokeJoin.Miter
	});
	if (!outlined) return null;
	return own(outlined);
}

/** The path as plain commands; conics and quads become cubics. */
export function pathToCommands(kit: CanvasKit, path: Path): PathCommand[] {
	const raw = path.toCmds();
	const commands: PathCommand[] = [];
	let x = 0;
	let y = 0;
	let index = 0;
	while (index < raw.length) {
		const verb = raw[index];
		index += 1;
		if (verb === kit.MOVE_VERB) {
			x = raw[index];
			y = raw[index + 1];
			index += 2;
			commands.push({ op: 'move', x, y });
		} else if (verb === kit.LINE_VERB) {
			x = raw[index];
			y = raw[index + 1];
			index += 2;
			commands.push({ op: 'line', x, y });
		} else if (verb === kit.QUAD_VERB) {
			commands.push(
				conicToCubic(x, y, raw[index], raw[index + 1], raw[index + 2], raw[index + 3], 1)
			);
			x = raw[index + 2];
			y = raw[index + 3];
			index += 4;
		} else if (verb === kit.CONIC_VERB) {
			const weight = raw[index + 4];
			commands.push(
				conicToCubic(x, y, raw[index], raw[index + 1], raw[index + 2], raw[index + 3], weight)
			);
			x = raw[index + 2];
			y = raw[index + 3];
			index += 5;
		} else if (verb === kit.CUBIC_VERB) {
			commands.push({
				op: 'cubic',
				x1: raw[index],
				y1: raw[index + 1],
				x2: raw[index + 2],
				y2: raw[index + 3],
				x: raw[index + 4],
				y: raw[index + 5]
			});
			x = raw[index + 4];
			y = raw[index + 5];
			index += 6;
		} else {
			commands.push({ op: 'close' });
		}
	}
	return commands;
}

/** A rational quadratic (weight 1 is a plain quad) as one cubic: exact for quads, tight for arcs. */
function conicToCubic(
	startX: number,
	startY: number,
	controlX: number,
	controlY: number,
	endX: number,
	endY: number,
	weight: number
): PathCommand {
	const reach = (4 * weight) / (3 * (1 + weight));
	return {
		op: 'cubic',
		x1: startX + (controlX - startX) * reach,
		y1: startY + (controlY - startY) * reach,
		x2: endX + (controlX - endX) * reach,
		y2: endY + (controlY - endY) * reach,
		x: endX,
		y: endY
	};
}
