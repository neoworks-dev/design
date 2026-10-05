// Planning for Flatten and Outline stroke (#103). The geometry (a vector network in the node's
// local space) is computed elsewhere (src/lib/renderer/flattenGeometry.ts for shapes, booleans and
// strokes, src/lib/text/textOutline.ts for text); this turns it into document changes. Both
// replace nodes by VECTOR nodes, so the result is canonical vector data (data-model section 7).

import {
	composeMatrices,
	createNode,
	generateNodeId,
	keyBetween,
	keysBetween,
	planRemove,
	planSetProps,
	translationMatrix,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type Paint,
	type Stroke,
	type VectorNetwork
} from '../document';
import { hasVisibleFill, nodeEffects, nodeStrokes } from '../document/shapeGeometry';
import { normalizeNetwork } from '../vector/geometry';

export interface FlattenPlan {
	changes: Change[];
	vectorId: NodeId;
}

export interface OutlinePlan {
	changes: Change[];
	vectorIds: NodeId[];
}

/** One stroke of a node and the area it covers, in the node's local space. */
export interface StrokeArea {
	stroke: Stroke;
	network: VectorNetwork;
}

export type FlattenableNode = Exclude<Node, { type: 'PAGE' | 'SECTION' | 'SLICE' }>;

/** The node types Flatten and Outline stroke work on: shapes with a position and size. */
export function isFlattenable(node: Node): node is FlattenableNode {
	return node.type !== 'PAGE' && node.type !== 'SLICE' && node.type !== 'SECTION';
}

function nodeFills(node: Node): Paint[] {
	if (!('fills' in node)) return [];
	return node.fills;
}

interface VectorSpec {
	name: string;
	fills: Paint[];
	strokes: Stroke[];
	index: string;
}

function vectorBeside(
	node: FlattenableNode,
	network: VectorNetwork,
	spec: VectorSpec
): ReturnType<typeof createNode> {
	const normalized = normalizeNetwork(network);
	return createNode('VECTOR', {
		id: generateNodeId(),
		name: spec.name,
		parentId: node.parentId,
		index: spec.index,
		transform: composeMatrices(
			node.transform,
			translationMatrix(normalized.origin.x, normalized.origin.y)
		),
		width: normalized.width,
		height: normalized.height,
		network: normalized.network,
		fills: spec.fills,
		strokes: spec.strokes,
		effects: [...nodeEffects(node)],
		opacity: node.opacity,
		blendMode: node.blendMode
	});
}

/**
 * Replace `id` (and everything below it) by one VECTOR node holding `network`, in its place with
 * its strokes, effects, opacity and name. `fills` overrides the node's own fills (a group or a
 * text takes them from what it holds).
 */
export function planFlattenNode(
	reader: DocumentReader,
	id: NodeId,
	network: VectorNetwork,
	fills?: Paint[]
): FlattenPlan | null {
	const node = reader.requireNode(id);
	if (!isFlattenable(node) || network.vertices.length === 0) return null;
	const vector = vectorBeside(node, network, {
		name: node.name,
		fills: fills === undefined ? nodeFills(node) : fills,
		strokes: [...nodeStrokes(node)],
		index: node.index
	});
	return { changes: [...planRemove(reader, id), { t: 'add', node: vector }], vectorId: vector.id };
}

/** The index of the sibling after `node`, or null when it is the topmost. */
function nextSiblingIndex(reader: DocumentReader, node: Node): string | null {
	if (node.parentId === null) return null;
	const siblings = reader.childNodes(node.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === node.id);
	if (position < 0 || position + 1 >= siblings.length) return null;
	return siblings[position + 1].index;
}

/**
 * Convert the strokes of `id` to fills. Every stroke becomes a VECTOR holding the area the stroke
 * covers, painted with the stroke's paints. A node that also has a visible fill stays, without
 * its strokes, and the vectors sit right above it; a node without a fill is replaced.
 */
export function planOutlineStroke(
	reader: DocumentReader,
	id: NodeId,
	areas: readonly StrokeArea[]
): OutlinePlan | null {
	const node = reader.requireNode(id);
	if (areas.length === 0 || !isFlattenable(node)) return null;
	const keepNode = hasVisibleFill(node);
	const indexes = outlineIndexes(reader, node, areas.length, keepNode);
	const vectors = areas.map((area, position) =>
		vectorBeside(node, area.network, {
			name: `${node.name} stroke`,
			fills: area.stroke.paints,
			strokes: [],
			index: indexes[position]
		})
	);
	const added = vectors.map((vector): Change => ({ t: 'add', node: vector }));
	const vectorIds = vectors.map((vector) => vector.id);
	if (keepNode) {
		return { changes: [...planSetProps(reader, id, { strokes: [] }), ...added], vectorIds };
	}
	return { changes: [...planRemove(reader, id), ...added], vectorIds };
}

function outlineIndexes(
	reader: DocumentReader,
	node: Node,
	count: number,
	keepNode: boolean
): string[] {
	const upper = nextSiblingIndex(reader, node);
	if (!keepNode) {
		const rest = keysBetween(node.index, upper, count - 1);
		return [node.index, ...rest];
	}
	if (count === 1) return [keyBetween(node.index, upper)];
	return keysBetween(node.index, upper, count);
}
