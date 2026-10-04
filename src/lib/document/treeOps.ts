// Planning functions for structural edits: they read the store and return the changes to apply,
// rejecting invalid ones (cycles, wrong parent kind) up front. Nothing here mutates.

import { keyBetween, rebalancedKeys } from './fractionalIndex';
import type { DocumentReader } from './store';
import type { NodeChange, NodeId, NodeType } from './types';

const CONTAINER_TYPES: readonly NodeType[] = [
	'PAGE',
	'FRAME',
	'GROUP',
	'SECTION',
	'BOOLEAN_OPERATION',
	'COMPONENT',
	'COMPONENT_SET',
	'INSTANCE'
];

export function canHaveChildren(type: NodeType): boolean {
	return CONTAINER_TYPES.includes(type);
}

/**
 * The fractional index for slot `position` among the children of `parentId`, not counting
 * `ignoreId` (the node being moved). 0 is first; a position past the end appends.
 */
export function indexAtPosition(
	store: DocumentReader,
	parentId: NodeId | null,
	position: number,
	ignoreId?: NodeId
): string {
	const siblings = store
		.childNodes(parentId)
		.filter((sibling) => sibling.id !== ignoreId)
		.map((sibling) => sibling.index);
	const slot = Math.max(0, Math.min(position, siblings.length));
	const before = slot > 0 ? siblings[slot - 1] : null;
	const after = slot < siblings.length ? siblings[slot] : null;
	return keyBetween(before, after);
}

/**
 * Move `id` under `parentId` (`null` makes it a page root) at slot `position`.
 * Throws when the move would create a cycle or breaks a structural rule.
 */
export function planMove(
	store: DocumentReader,
	id: NodeId,
	parentId: NodeId | null,
	position: number
): NodeChange {
	const node = store.requireNode(id);
	assertValidParent(store, id, parentId);
	return {
		t: 'move',
		id,
		parent: parentId,
		index: indexAtPosition(store, parentId, position, id),
		prevParent: node.parentId,
		prevIndex: node.index
	};
}

/** Reorder `id` among its current siblings. */
export function planReorder(store: DocumentReader, id: NodeId, position: number): NodeChange {
	return planMove(store, id, store.requireNode(id).parentId, position);
}

export function assertValidParent(
	store: DocumentReader,
	id: NodeId,
	parentId: NodeId | null
): void {
	const node = store.requireNode(id);
	if (node.type === 'PAGE') {
		if (parentId !== null) throw new Error(`page ${id} must stay a root`);
		return;
	}
	if (parentId === null) throw new Error(`only pages can be roots, not ${node.type} ${id}`);
	const parent = store.requireNode(parentId);
	if (!canHaveChildren(parent.type)) {
		throw new Error(`${parent.type} ${parentId} cannot have children`);
	}
	if (parentId === id || store.isDescendantOf(parentId, id)) {
		throw new Error(`cannot move ${id} into its own subtree (${parentId})`);
	}
}

/** Fresh evenly spaced indexes for all children of `parentId`, keeping their order. */
export function planRebalance(store: DocumentReader, parentId: NodeId | null): NodeChange[] {
	const siblings = store.childNodes(parentId);
	const keys = rebalancedKeys(siblings.length);
	return siblings.map((sibling, position) => ({
		t: 'move',
		id: sibling.id,
		parent: parentId,
		index: keys[position],
		prevParent: parentId,
		prevIndex: sibling.index
	}));
}

/** The longest sibling index under `parentId`; a rebalance trigger for callers. */
export function longestIndexLength(store: DocumentReader, parentId: NodeId | null): number {
	let longest = 0;
	for (const sibling of store.childNodes(parentId)) {
		longest = Math.max(longest, sibling.index.length);
	}
	return longest;
}
