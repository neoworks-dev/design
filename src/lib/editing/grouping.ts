// Planning for group, frame selection and ungroup (docs/research/interactions.md section 13).
// Every plan keeps absolute positions: a node's transform is stored relative to its parent, so
// moving it between parents rewrites that transform.

import {
	composeMatrices,
	createNode,
	invertMatrix,
	keyBetween,
	keysBetween,
	translationMatrix,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Rect
} from '../document';
import {
	commonParentId,
	isPositioned,
	sortByDocumentOrder,
	topLevelIds,
	unionBounds,
	type PositionedNode
} from './selectionOps';

export type WrapperKind = 'GROUP' | 'FRAME' | 'COMPONENT';

const WRAPPER_PREFIX: Record<WrapperKind, string> = {
	GROUP: 'Group',
	FRAME: 'Frame',
	COMPONENT: 'Component'
};

export interface WrapPlan {
	changes: Change[];
	wrapperId: NodeId;
}

export interface UngroupPlan {
	changes: Change[];
	/** The nodes that were lifted out, in z-order, for the selection to adopt. */
	liftedIds: NodeId[];
}

const UNGROUPABLE_TYPES = ['GROUP', 'FRAME'];

/** The first "Group N" / "Frame N" name that no node on the page uses yet. */
export function nextDefaultName(reader: DocumentReader, nodeId: NodeId, prefix: string): string {
	const page = reader.pageOf(nodeId);
	const pattern = new RegExp(`^${prefix} (\\d+)$`);
	let highest = 0;
	for (const node of reader.descendants(page.id)) {
		const match = pattern.exec(node.name);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return `${prefix} ${highest + 1}`;
}

function wrapperIndex(reader: DocumentReader, parentId: NodeId, members: NodeId[]): string {
	const siblings = reader.childNodes(parentId);
	const memberSet = new Set(members);
	let topmost = -1;
	siblings.forEach((sibling, position) => {
		if (memberSet.has(sibling.id)) topmost = position;
	});
	if (topmost === -1) return keyBetween(siblings.at(-1)?.index ?? null, null);
	return keyBetween(siblings[topmost].index, siblings[topmost + 1]?.index ?? null);
}

function groupableMembers(reader: DocumentReader, ids: readonly NodeId[]): PositionedNode[] {
	const members: PositionedNode[] = [];
	for (const id of sortByDocumentOrder(reader, topLevelIds(reader, ids))) {
		const node = reader.requireNode(id);
		if (isPositioned(node)) members.push(node);
	}
	return members;
}

function wrapperTransform(reader: DocumentReader, parentId: NodeId, bounds: Rect): Matrix2x3 {
	const absolute = translationMatrix(bounds.x, bounds.y);
	const inverse = invertMatrix(reader.cache.absoluteTransform(parentId));
	if (inverse === null) return absolute;
	return composeMatrices(inverse, absolute);
}

function moveIntoWrapper(
	node: Node,
	wrapperId: NodeId,
	index: string,
	absolute: Matrix2x3,
	bounds: Rect
): Change[] {
	const [[a, c, e], [b, d, f]] = absolute;
	const transform: Matrix2x3 = [
		[a, c, e - bounds.x],
		[b, d, f - bounds.y]
	];
	return [
		{
			t: 'move',
			id: node.id,
			parent: wrapperId,
			index,
			prevParent: node.parentId,
			prevIndex: node.index
		},
		{
			t: 'set',
			id: node.id,
			set: { transform },
			prev: { transform: Reflect.get(node, 'transform') }
		}
	];
}

/**
 * Wrap the selection in a new group or frame. It sits in the common parent (the first selected
 * node's parent when they differ) at the topmost selected node's z-index, sized to the union of
 * the nodes' bounds. Returns `null` when nothing can be wrapped.
 */
export function planWrap(
	reader: DocumentReader,
	ids: readonly NodeId[],
	kind: WrapperKind,
	wrapperId: NodeId
): WrapPlan | null {
	const members = groupableMembers(reader, ids);
	if (members.length === 0) return null;
	const memberIds = members.map((member) => member.id);
	const sharedParent = commonParentId(reader, memberIds);
	const parentId = sharedParent === null ? members[0].parentId : sharedParent;
	if (parentId === null) return null;

	const bounds = unionBounds(memberIds.map((id) => reader.cache.absoluteBounds(id)));
	const prefix = WRAPPER_PREFIX[kind];
	const wrapper = createNode(kind, {
		id: wrapperId,
		name: nextDefaultName(reader, parentId, prefix),
		parentId,
		index: wrapperIndex(reader, parentId, memberIds),
		transform: wrapperTransform(reader, parentId, bounds),
		width: bounds.width,
		height: bounds.height
	});
	const keys = keysBetween(null, null, members.length);
	const changes: Change[] = [{ t: 'add', node: wrapper }];
	members.forEach((member, position) => {
		const absolute = reader.cache.absoluteTransform(member.id);
		changes.push(...moveIntoWrapper(member, wrapperId, keys[position], absolute, bounds));
	});
	return { changes, wrapperId };
}

function liftChildren(reader: DocumentReader, container: Node): Change[] {
	if (container.parentId === null) return [];
	const siblings = reader.childNodes(container.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === container.id);
	const upper = siblings[position + 1]?.index ?? null;
	const children = reader.childNodes(container.id);
	const keys = keysBetween(container.index, upper, children.length);
	const changes: Change[] = [];
	children.forEach((child, childPosition) => {
		changes.push({
			t: 'move',
			id: child.id,
			parent: container.parentId,
			index: keys[childPosition],
			prevParent: container.id,
			prevIndex: child.index
		});
		if (!isPositioned(child) || !isPositioned(container)) return;
		const transform = composeMatrices(container.transform, child.transform);
		changes.push({
			t: 'set',
			id: child.id,
			set: { transform },
			prev: { transform: child.transform }
		});
	});
	return changes;
}

/** Replace each selected group or frame by its children, keeping z-order and absolute position. */
export function planUngroup(reader: DocumentReader, ids: readonly NodeId[]): UngroupPlan {
	const plan: UngroupPlan = { changes: [], liftedIds: [] };
	for (const id of sortByDocumentOrder(reader, topLevelIds(reader, ids))) {
		const container = reader.requireNode(id);
		if (!UNGROUPABLE_TYPES.includes(container.type)) continue;
		plan.changes.push(...liftChildren(reader, container));
		plan.changes.push({ t: 'del', node: container });
		plan.liftedIds.push(...reader.children(id));
	}
	return plan;
}
