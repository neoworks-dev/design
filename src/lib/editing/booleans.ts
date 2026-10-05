// Planning for boolean operations (issue #102): wrap the selection in a live BOOLEAN_OPERATION
// node and, for Flatten, replace one by a VECTOR node holding its result. The geometry of the
// result is derived (src/lib/renderer/booleanOps.ts); the node only keeps its operands.

import {
	createNode,
	type Change,
	type DocumentReader,
	type NodeId,
	type Paint,
	type Stroke,
	type VectorNetwork
} from '../document';
import type { BooleanOperationNode } from '../document/types';
import { planFlattenNode, type FlattenPlan } from './flatten';
import { planWrap } from './grouping';
import { sortByDocumentOrder, topLevelIds } from './selectionOps';

export type BooleanOperation = BooleanOperationNode['booleanOperation'];

export const BOOLEAN_TITLES: Record<BooleanOperation, string> = {
	UNION: 'Union',
	SUBTRACT: 'Subtract',
	INTERSECT: 'Intersect',
	EXCLUDE: 'Exclude'
};

const DEFAULT_FILL: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 0.85, g: 0.85, b: 0.85 }
};

export interface BooleanPlan {
	changes: Change[];
	booleanId: NodeId;
}

interface Paintable {
	fills: Paint[];
	strokes: Stroke[];
}

function paintOf(reader: DocumentReader, id: NodeId): Paintable {
	const node = reader.requireNode(id);
	if (!('fills' in node) || !('strokes' in node)) return { fills: [], strokes: [] };
	return { fills: node.fills, strokes: node.strokes };
}

/**
 * The selection becomes the operands of a new boolean node. It sits where a group would, takes
 * the fills and strokes of the bottom-most operand, and the bottom-most operand is the base of a
 * subtraction. Needs two operands (top level selected nodes); `null` otherwise.
 */
export function planBoolean(
	reader: DocumentReader,
	ids: readonly NodeId[],
	operation: BooleanOperation,
	booleanId: NodeId
): BooleanPlan | null {
	const operands = sortByDocumentOrder(reader, topLevelIds(reader, ids));
	if (operands.length < 2) return null;
	const wrap = planWrap(reader, operands, 'GROUP', booleanId);
	if (!wrap) return null;
	const first = wrap.changes[0];
	if (first.t !== 'add' || first.node.type !== 'GROUP') return null;
	const group = first.node;
	const base = paintOf(reader, operands[0]);
	const boolean = createNode('BOOLEAN_OPERATION', {
		id: group.id,
		name: BOOLEAN_TITLES[operation],
		parentId: group.parentId,
		index: group.index,
		transform: group.transform,
		width: group.width,
		height: group.height,
		booleanOperation: operation,
		fills: base.fills.length > 0 || base.strokes.length > 0 ? base.fills : [DEFAULT_FILL],
		strokes: base.strokes
	});
	return { changes: [{ t: 'add', node: boolean }, ...wrap.changes.slice(1)], booleanId };
}

/** Changes the operation of existing boolean nodes. */
export function planSetOperation(
	reader: DocumentReader,
	ids: readonly NodeId[],
	operation: BooleanOperation
): Change[] {
	const changes: Change[] = [];
	for (const id of ids) {
		const node = reader.requireNode(id);
		if (node.type !== 'BOOLEAN_OPERATION' || node.booleanOperation === operation) continue;
		changes.push({
			t: 'set',
			id,
			set: { booleanOperation: operation, name: nameAfterChange(node, operation) },
			prev: { booleanOperation: node.booleanOperation, name: node.name }
		});
	}
	return changes;
}

function nameAfterChange(node: BooleanOperationNode, operation: BooleanOperation): string {
	if (node.name === BOOLEAN_TITLES[node.booleanOperation]) return BOOLEAN_TITLES[operation];
	return node.name;
}

/**
 * Replace the boolean node `id` (and its operands) by one VECTOR node holding `network`, in the
 * boolean's place with its paint, effects and name. `network` is in the boolean's local space.
 * Flattening other nodes is `planFlattenNode` (flatten.ts).
 */
export function planFlatten(
	reader: DocumentReader,
	id: NodeId,
	network: VectorNetwork
): FlattenPlan | null {
	if (reader.requireNode(id).type !== 'BOOLEAN_OPERATION') return null;
	return planFlattenNode(reader, id, network);
}
