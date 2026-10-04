// Selection commands that work on a whole level of the tree: select all, invert, select
// matching. Pure: they read a `DocumentReader` and return ids.

import type { DocumentReader, Node, NodeId } from '../document';
import { commonParentId, sortByDocumentOrder } from '../editing/selectionOps';
import { isSelectable } from './marquee';

/**
 * The container whose children "the current level" means: the parent the selection shares, else
 * the selection scope, else the page.
 */
export function levelContainer(
	reader: DocumentReader,
	selected: readonly NodeId[],
	scopeId: NodeId | null,
	pageId: NodeId
): NodeId {
	const shared = commonParentId(reader, selected);
	if (shared !== null) return shared;
	if (scopeId !== null && reader.hasNode(scopeId)) return scopeId;
	return pageId;
}

function selectableChildren(reader: DocumentReader, containerId: NodeId): NodeId[] {
	return reader.children(containerId).filter((id) => isSelectable(reader.requireNode(id)));
}

export function planSelectAll(reader: DocumentReader, containerId: NodeId): NodeId[] {
	return selectableChildren(reader, containerId);
}

export function planInvert(
	reader: DocumentReader,
	containerId: NodeId,
	selected: readonly NodeId[]
): NodeId[] {
	return selectableChildren(reader, containerId).filter((id) => !selected.includes(id));
}

function styleKey(node: Node): string {
	const style: { type: string; fills?: unknown; strokes?: unknown } = { type: node.type };
	if ('fills' in node) style.fills = node.fills;
	if ('strokes' in node) style.strokes = node.strokes;
	return JSON.stringify(style);
}

/** Every selectable node under `rootId` with the same type and fill and stroke as `sample`. */
export function planSelectMatching(
	reader: DocumentReader,
	rootId: NodeId,
	sampleId: NodeId
): NodeId[] {
	const key = styleKey(reader.requireNode(sampleId));
	const matches: NodeId[] = [];
	const visit = (parentId: NodeId): void => {
		for (const id of reader.children(parentId)) {
			const node = reader.requireNode(id);
			if (!isSelectable(node)) continue;
			if (styleKey(node) === key) matches.push(id);
			visit(id);
		}
	};
	visit(rootId);
	return sortByDocumentOrder(reader, matches);
}
