// Deep clone of a subtree with fresh ids: the building block of duplicate, paste and component
// instantiation. Returns changes, so the caller applies them as part of one transaction.

import { generateNodeId, type IdGenerator } from './ids';
import { keyBetween } from './fractionalIndex';
import type { DocumentReader } from './store';
import type { Node, NodeChange, NodeId } from './types';

export interface CloneOptions {
	/** Parent for the cloned root; defaults to the original's parent. */
	parentId?: NodeId | null;
	/** Index for the cloned root; defaults to right after the original among its siblings. */
	index?: string;
	idGenerator?: IdGenerator;
}

export interface CloneResult {
	rootId: NodeId;
	/** Cloned nodes, parents before children. */
	nodes: Node[];
	/** Original id to clone id, for every node in the subtree. */
	idMap: Map<NodeId, NodeId>;
	/** One `add` per cloned node, in a valid application order. */
	changes: NodeChange[];
}

export function cloneSubtree(
	store: DocumentReader,
	rootId: NodeId,
	options: CloneOptions = {}
): CloneResult {
	const generate = options.idGenerator ?? generateNodeId;
	const root = store.requireNode(rootId);
	const originals = [root, ...store.descendants(rootId)];
	const idMap = new Map<NodeId, NodeId>(originals.map((node) => [node.id, generate()]));

	const parentId = options.parentId === undefined ? root.parentId : options.parentId;
	const index = options.index === undefined ? indexAfter(store, root) : options.index;

	const nodes = originals.map((original) => {
		const copy = structuredClone(original);
		remapReferences(copy, idMap);
		copy.id = lookup(idMap, original.id);
		if (original.id === rootId) {
			copy.parentId = parentId;
			copy.index = index;
			return copy;
		}
		if (original.parentId === null) return copy;
		copy.parentId = lookup(idMap, original.parentId);
		return copy;
	});

	const changes: NodeChange[] = nodes.map((node) => ({ t: 'add', node }));
	return { rootId: lookup(idMap, rootId), nodes, idMap, changes };
}

function indexAfter(store: DocumentReader, node: Node): string {
	const siblings = store.childNodes(node.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === node.id);
	const next = siblings[position + 1];
	if (!next) return keyBetween(node.index, null);
	return keyBetween(node.index, next.index);
}

function lookup(idMap: Map<NodeId, NodeId>, id: NodeId): NodeId {
	const mapped = idMap.get(id);
	if (mapped === undefined) throw new Error(`id not in clone map: ${id}`);
	return mapped;
}

/**
 * References that point inside the cloned subtree follow the copy; references that point outside
 * (a main component elsewhere, a prototype destination on another frame) stay as they are.
 */
function remapReferences(node: Node, idMap: Map<NodeId, NodeId>): void {
	if (node.componentRef !== undefined && idMap.has(node.componentRef)) {
		node.componentRef = lookup(idMap, node.componentRef);
	}
	if (node.type === 'INSTANCE' && idMap.has(node.mainComponentId)) {
		node.mainComponentId = lookup(idMap, node.mainComponentId);
	}
	if (node.type === 'PAGE') {
		for (const flow of node.flowStartingPoints) {
			if (idMap.has(flow.nodeId)) flow.nodeId = lookup(idMap, flow.nodeId);
		}
		return;
	}
	if (node.type === 'SLICE' || node.type === 'SECTION') return;
	for (const reaction of node.reactions) {
		for (const action of reaction.actions) {
			if (action.type !== 'NODE' || action.destinationId === null) continue;
			if (idMap.has(action.destinationId))
				action.destinationId = lookup(idMap, action.destinationId);
		}
	}
}
