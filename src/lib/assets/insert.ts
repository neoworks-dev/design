// Where an instance dragged or inserted from the assets panel goes. Pure: no Svelte, no kernel.
// The instance lands inside the nearest frame under the point (never inside another instance:
// that would be an override), centred on the point in that frame's own space.

import {
	invertMatrix,
	isFrameLike,
	keyBetween,
	planCreateInstance,
	transformPoint,
	type DocumentReader,
	type InstancePlan,
	type Node,
	type Matrix2x3,
	type NodeId
} from '../document';

export interface Point {
	x: number;
	y: number;
}

/** The node an instance dropped on `hitId` goes into: the nearest frame that is not an instance. */
export function insertionParent(
	reader: DocumentReader,
	hitId: NodeId | undefined,
	pageId: NodeId
): NodeId {
	let current: Node | undefined = hitId === undefined ? undefined : reader.getNode(hitId);
	while (current !== undefined && current.type !== 'PAGE') {
		if (isFrameLike(current) && current.type !== 'INSTANCE' && !isInsideInstance(reader, current)) {
			return current.id;
		}
		if (current.parentId === null) break;
		current = reader.getNode(current.parentId);
	}
	return pageId;
}

function isInsideInstance(reader: DocumentReader, node: Node): boolean {
	return reader.ancestors(node.id).some((ancestor) => ancestor.type === 'INSTANCE');
}

function lastIndexIn(reader: DocumentReader, parentId: NodeId): string {
	const children = reader.childNodes(parentId);
	if (children.length === 0) return keyBetween(null, null);
	return keyBetween(children[children.length - 1].index, null);
}

/** Changes that create an instance of `mainId` in `parentId`, centred on the page point `world`. */
export function planInstanceAt(
	reader: DocumentReader,
	mainId: NodeId,
	parentId: NodeId,
	world: Point
): InstancePlan {
	const main = reader.requireNode(mainId);
	if (main.type !== 'COMPONENT') throw new Error(`${mainId} is not a component`);
	let local = world;
	const parent = reader.requireNode(parentId);
	if (parent.type !== 'PAGE') {
		const inverse = invertMatrix(reader.cache.absoluteTransform(parentId));
		if (inverse !== null) local = transformPoint(inverse, world.x, world.y);
	}
	const transform: Matrix2x3 = [
		[1, 0, local.x - main.width / 2],
		[0, 1, local.y - main.height / 2]
	];
	return planCreateInstance(reader, mainId, {
		parentId,
		index: lastIndexIn(reader, parentId),
		transform
	});
}
