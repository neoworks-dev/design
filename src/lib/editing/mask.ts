// Use selection as mask (docs/research/interactions.md section 13). The topmost selected layer
// becomes the mask of everything below it in the same group; with several layers selected they
// are grouped first. Drawing the masking (mask fill ignored, clipping by type) belongs to the
// renderer; this file only decides which layer is the mask and of what kind.
// Pure: planners return changes.

import type { Change, DocumentReader, Node, NodeId } from '../document';
import { planWrap } from './grouping';
import { sortByDocumentOrder, topLevelIds } from './selectionOps';

export type MaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE';

export interface MaskPlan {
	changes: Change[];
	/** The selection to adopt afterwards: the new group, or the layers that stay selected. */
	selectIds: NodeId[];
}

function canBeMask(node: Node): boolean {
	return 'isMask' in node;
}

function isMask(node: Node): boolean {
	return Reflect.get(node, 'isMask') === true;
}

function setMask(node: Node, enabled: boolean): Change {
	return {
		t: 'set',
		id: node.id,
		set: { isMask: enabled },
		prev: { isMask: Reflect.get(node, 'isMask') }
	};
}

function selectedMasks(reader: DocumentReader, ids: readonly NodeId[]): Node[] {
	const masks: Node[] = [];
	for (const id of ids) {
		const node = reader.requireNode(id);
		if (isMask(node)) masks.push(node);
	}
	return masks;
}

/** True when the selection already holds a mask, so the command removes masking instead. */
export function selectionHasMask(reader: DocumentReader, ids: readonly NodeId[]): boolean {
	return selectedMasks(reader, ids).length > 0;
}

function removeMasks(masks: Node[]): MaskPlan {
	return { changes: masks.map((mask) => setMask(mask, false)), selectIds: masks.map((m) => m.id) };
}

/**
 * Toggle masking for the selection. When a selected layer is already a mask the masking is
 * removed (the group stays). Otherwise the topmost selected layer becomes the mask; with several
 * layers selected they are wrapped in a group first. Returns `null` when nothing can be masked.
 */
export function planMaskToggle(
	reader: DocumentReader,
	ids: readonly NodeId[],
	wrapperId: NodeId
): MaskPlan | null {
	const masks = selectedMasks(reader, ids);
	if (masks.length > 0) return removeMasks(masks);

	const ordered = sortByDocumentOrder(reader, topLevelIds(reader, ids));
	const topmostId = ordered.at(-1);
	if (topmostId === undefined) return null;
	const topmost = reader.requireNode(topmostId);
	if (!canBeMask(topmost)) return null;
	if (ordered.length === 1) return { changes: [setMask(topmost, true)], selectIds: [topmostId] };

	const wrap = planWrap(reader, ordered, 'GROUP', wrapperId);
	if (wrap === null) return null;
	return {
		changes: [...wrap.changes, setMask(topmost, true)],
		selectIds: [wrap.wrapperId]
	};
}

/** Change the mask type of every selected mask; layers that are not masks are left alone. */
export function planSetMaskType(
	reader: DocumentReader,
	ids: readonly NodeId[],
	maskType: MaskType
): Change[] {
	const changes: Change[] = [];
	for (const mask of selectedMasks(reader, ids)) {
		if (Reflect.get(mask, 'maskType') === maskType) continue;
		changes.push({
			t: 'set',
			id: mask.id,
			set: { maskType },
			prev: { maskType: Reflect.get(mask, 'maskType') }
		});
	}
	return changes;
}
