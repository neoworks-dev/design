// Children are derived, never stored (data-model.md section 1). ChildIndex keeps the derived
// parent -> ordered child ids lists so `children(parent)` does not scan the whole node map.

import { compareSiblings } from './fractionalIndex';
import type { Node, NodeId } from './types';

export type NodeMap = Record<NodeId, Node>;

interface SiblingKey {
	id: NodeId;
	index: string;
}

export class ChildIndex {
	private readonly childrenByParent = new Map<NodeId | null, SiblingKey[]>();

	constructor(nodes: NodeMap) {
		for (const node of Object.values(nodes)) this.siblingsOf(node.parentId).push(keyOf(node));
		for (const siblings of this.childrenByParent.values()) siblings.sort(compareSiblings);
	}

	children(parentId: NodeId | null): NodeId[] {
		const siblings = this.childrenByParent.get(parentId);
		if (!siblings) return [];
		return siblings.map((sibling) => sibling.id);
	}

	childCount(parentId: NodeId | null): number {
		const siblings = this.childrenByParent.get(parentId);
		if (!siblings) return 0;
		return siblings.length;
	}

	insert(node: Node): void {
		const siblings = this.siblingsOf(node.parentId);
		const key = keyOf(node);
		siblings.splice(insertionPoint(siblings, key), 0, key);
	}

	/** `parentId` and `index` are the values the node was inserted with. */
	remove(id: NodeId, parentId: NodeId | null, index: string): void {
		const siblings = this.childrenByParent.get(parentId);
		if (!siblings) return;
		const position = insertionPoint(siblings, { id, index });
		if (siblings[position]?.id !== id) throw new Error(`child index out of sync for ${id}`);
		siblings.splice(position, 1);
		if (siblings.length === 0) this.childrenByParent.delete(parentId);
	}

	private siblingsOf(parentId: NodeId | null): SiblingKey[] {
		const existing = this.childrenByParent.get(parentId);
		if (existing) return existing;
		const created: SiblingKey[] = [];
		this.childrenByParent.set(parentId, created);
		return created;
	}
}

function keyOf(node: Node): SiblingKey {
	return { id: node.id, index: node.index };
}

function insertionPoint(siblings: SiblingKey[], key: SiblingKey): number {
	let low = 0;
	let high = siblings.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (compareSiblings(siblings[middle], key) < 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}
