// Planning for z-order commands. Stacking is the sibling order (fractional index), so reordering
// is a set of `move` changes within one parent. Selected siblings keep their relative order, and
// only the selected nodes get new indexes: the others keep theirs.

import { keysBetween, type Change, type DocumentReader, type Node, type NodeId } from '../document';
import { topLevelIds } from './selectionOps';

export type ZOrderAction = 'front' | 'back' | 'forward' | 'backward';

function moveToEnd(order: NodeId[], selected: Set<NodeId>, toFront: boolean): NodeId[] {
	const chosen = order.filter((id) => selected.has(id));
	const others = order.filter((id) => !selected.has(id));
	if (toFront) return [...others, ...chosen];
	return [...chosen, ...others];
}

// One step: every selected block swaps with the unselected sibling next to it. Walking from the
// leading edge keeps a block of adjacent selected nodes together.
function stepOrder(order: NodeId[], selected: Set<NodeId>, upwards: boolean): NodeId[] {
	const result = [...order];
	if (upwards) {
		for (let position = result.length - 2; position >= 0; position -= 1) {
			if (selected.has(result[position]) && !selected.has(result[position + 1])) {
				[result[position], result[position + 1]] = [result[position + 1], result[position]];
			}
		}
		return result;
	}
	for (let position = 1; position < result.length; position += 1) {
		if (selected.has(result[position]) && !selected.has(result[position - 1])) {
			[result[position], result[position - 1]] = [result[position - 1], result[position]];
		}
	}
	return result;
}

function targetOrder(order: NodeId[], selected: Set<NodeId>, action: ZOrderAction): NodeId[] {
	if (action === 'front') return moveToEnd(order, selected, true);
	if (action === 'back') return moveToEnd(order, selected, false);
	return stepOrder(order, selected, action === 'forward');
}

function sameSequence(left: readonly NodeId[], right: readonly NodeId[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((id, position) => id === right[position]);
}

function isUnchangedSlot(
	siblings: Node[],
	run: NodeId[],
	lower: string | null,
	upper: string | null
): boolean {
	const between = siblings
		.filter((sibling) => lower === null || sibling.index > lower)
		.filter((sibling) => upper === null || sibling.index < upper)
		.map((sibling) => sibling.id);
	return sameSequence(between, run);
}

// Runs of selected nodes in the final order sit between two unselected neighbours (or an end);
// each run gets fresh keys strictly between the neighbours' keys.
function planRuns(
	siblings: Node[],
	finalOrder: NodeId[],
	selected: Set<NodeId>,
	parentId: NodeId
): Change[] {
	const byId = new Map(siblings.map((sibling) => [sibling.id, sibling]));
	const changes: Change[] = [];
	let position = 0;
	while (position < finalOrder.length) {
		if (!selected.has(finalOrder[position])) {
			position += 1;
			continue;
		}
		const start = position;
		while (position < finalOrder.length && selected.has(finalOrder[position])) position += 1;
		const run = finalOrder.slice(start, position);
		const lower = start === 0 ? null : (byId.get(finalOrder[start - 1])?.index ?? null);
		const upper =
			position === finalOrder.length ? null : (byId.get(finalOrder[position])?.index ?? null);
		if (isUnchangedSlot(siblings, run, lower, upper)) continue;
		const keys = keysBetween(lower, upper, run.length);
		run.forEach((id, runPosition) => {
			const node = byId.get(id);
			if (!node || node.index === keys[runPosition]) return;
			changes.push({
				t: 'move',
				id,
				parent: parentId,
				index: keys[runPosition],
				prevParent: parentId,
				prevIndex: node.index
			});
		});
	}
	return changes;
}

function planGroupOfSiblings(
	reader: DocumentReader,
	parentId: NodeId,
	ids: NodeId[],
	action: ZOrderAction
): Change[] {
	const siblings = reader.childNodes(parentId);
	const order = siblings.map((sibling) => sibling.id);
	const selected = new Set(ids);
	const finalOrder = targetOrder(order, selected, action);
	if (sameSequence(order, finalOrder)) return [];
	return planRuns(siblings, finalOrder, selected, parentId);
}

/** Reorder the selected nodes within their parents. Nodes of different parents are independent. */
export function planZOrder(
	reader: DocumentReader,
	ids: readonly NodeId[],
	action: ZOrderAction
): Change[] {
	const byParent = new Map<NodeId, NodeId[]>();
	for (const id of topLevelIds(reader, ids)) {
		const parentId = reader.requireNode(id).parentId;
		if (parentId === null) continue;
		const group = byParent.get(parentId);
		if (group) group.push(id);
		else byParent.set(parentId, [id]);
	}
	const changes: Change[] = [];
	for (const [parentId, siblingIds] of byParent) {
		changes.push(...planGroupOfSiblings(reader, parentId, siblingIds, action));
	}
	return changes;
}
