// Plans for "add auto layout" (Shift+A) and "remove auto layout" (Alt+Shift+A).
//
//   frame without auto layout   gets auto layout; direction, gap, padding and alignment are read
//                               off where its children are, and the children are put in stacking
//                               order by position so nothing jumps
//   anything else               is wrapped in a new auto layout frame at the same position, one
//                               frame per parent
//   remove                      turns auto layout off; the stored geometry already is the last
//                               computed layout, so every child stays where it is
//
// Pure: reads a `DocumentReader`, returns changes.

import {
	keysBetween,
	planSetProps,
	transformedBounds,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type Rect
} from '../document';
import { planWrap } from '../editing/grouping';
import { isPositioned, topLevelIds } from '../editing/selectionOps';
import { isStackContainer } from './build';
import { inferLayout, type InferredLayout } from './infer';

export interface AddAutoLayoutPlan {
	changes: Change[];
	/** What the selection becomes: the new wrappers and the frames that got auto layout. */
	selectIds: NodeId[];
}

const HUG_PROPERTIES = {
	layoutSizingHorizontal: 'HUG',
	layoutSizingVertical: 'HUG',
	primaryAxisSizingMode: 'AUTO',
	counterAxisSizingMode: 'AUTO'
} as const;

/** A frame that can take auto layout but has none yet. */
export function canGainAutoLayout(node: Node): boolean {
	if (!('layoutMode' in node)) return false;
	return node.layoutMode === 'NONE';
}

function relativeRect(node: Node): Rect | undefined {
	if (!isPositioned(node)) return undefined;
	return transformedBounds(node.transform, node.width, node.height);
}

function rectsOf(nodes: readonly Node[]): Map<NodeId, Rect> {
	const rects = new Map<NodeId, Rect>();
	for (const node of nodes) {
		const rect = relativeRect(node);
		if (rect !== undefined) rects.set(node.id, rect);
	}
	return rects;
}

/** Ids in stacking order for `layout`: along the primary axis, then the counter axis. */
function stackingOrder(rects: Map<NodeId, Rect>, layout: InferredLayout): NodeId[] {
	const horizontal = layout.layoutMode === 'HORIZONTAL';
	const primary = (rect: Rect): number => (horizontal ? rect.x : rect.y);
	const counter = (rect: Rect): number => (horizontal ? rect.y : rect.x);
	return [...rects.entries()]
		.sort(([, first], [, second]) => {
			if (primary(first) !== primary(second)) return primary(first) - primary(second);
			return counter(first) - counter(second);
		})
		.map(([id]) => id);
}

/** Fractional-index moves that give `order` to the children of `parentId`, if it differs. */
function planReorder(reader: DocumentReader, parentId: NodeId, order: readonly NodeId[]): Change[] {
	const current = reader.children(parentId).filter((id) => order.includes(id));
	if (current.every((id, position) => id === order[position])) return [];
	const all = reader.childNodes(parentId);
	const keys = keysBetween(null, null, all.length);
	const sequence = [...order, ...all.map((node) => node.id).filter((id) => !order.includes(id))];
	const changes: Change[] = [];
	sequence.forEach((id, position) => {
		const node = reader.requireNode(id);
		if (node.index === keys[position]) return;
		changes.push({
			t: 'move',
			id,
			parent: parentId,
			index: keys[position],
			prevParent: parentId,
			prevIndex: node.index
		});
	});
	return changes;
}

function planFrame(reader: DocumentReader, frame: Node): Change[] {
	if (!isPositioned(frame)) return [];
	const children = reader.childNodes(frame.id).filter((child) => child.type !== 'PAGE');
	const rects = rectsOf(children.filter((child) => 'visible' in child && child.visible));
	const layout = inferLayout([...rects.values()], { width: frame.width, height: frame.height });
	const props: Record<string, unknown> = { ...layout };
	if (children.length > 0) Object.assign(props, HUG_PROPERTIES);
	return [
		...planSetProps(reader, frame.id, props),
		...planReorder(reader, frame.id, stackingOrder(rects, layout))
	];
}

function planWrapper(
	reader: DocumentReader,
	ids: readonly NodeId[],
	wrapperId: NodeId
): Change[] | null {
	const plan = planWrap(reader, ids, 'FRAME', wrapperId);
	if (plan === null) return null;
	const [added, ...rest] = plan.changes;
	if (added.t !== 'add' || added.node.type !== 'FRAME') return null;
	const wrapper = added.node;
	const members = new Map<NodeId, Rect>();
	for (const change of rest) {
		if (change.t !== 'set') continue;
		const node = reader.requireNode(change.id);
		if (!isPositioned(node)) continue;
		const transform = change.set.transform as typeof node.transform;
		members.set(change.id, transformedBounds(transform, node.width, node.height));
	}
	const layout = inferLayout([...members.values()], {
		width: wrapper.width,
		height: wrapper.height
	});
	const order = stackingOrder(members, layout);
	const keys = keysBetween(null, null, order.length);
	const reindexed = rest.map((change) => {
		if (change.t !== 'move') return change;
		return { ...change, index: keys[order.indexOf(change.id)] };
	});
	const configured: Node = { ...wrapper, ...layout, ...HUG_PROPERTIES };
	return [{ t: 'add', node: configured }, ...reindexed];
}

/** Shift+A over `ids`. `newId` makes ids for the wrapper frames. */
export function planAddAutoLayout(
	reader: DocumentReader,
	ids: readonly NodeId[],
	newId: () => NodeId
): AddAutoLayoutPlan {
	const plan: AddAutoLayoutPlan = { changes: [], selectIds: [] };
	const wrapped = new Map<NodeId, NodeId[]>();
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (node.type === 'PAGE') continue;
		if (canGainAutoLayout(node)) {
			plan.changes.push(...planFrame(reader, node));
			plan.selectIds.push(id);
			continue;
		}
		if (node.parentId === null) continue;
		wrapped.set(node.parentId, [...(wrapped.get(node.parentId) ?? []), id]);
	}
	for (const members of wrapped.values()) {
		const wrapperId = newId();
		const changes = planWrapper(reader, members, wrapperId);
		if (changes === null) continue;
		plan.changes.push(...changes);
		plan.selectIds.push(wrapperId);
	}
	return plan;
}

function frameSizing(sizing: string, parentIsStack: boolean): string {
	if (sizing === 'HUG') return 'FIXED';
	if (sizing === 'FILL' && !parentIsStack) return 'FIXED';
	return sizing;
}

/** Children lose their auto layout parent, so a fill size has nothing left to fill. */
function childSizing(sizing: string): string {
	if (sizing === 'FILL') return 'FIXED';
	return sizing;
}

function hasStackParent(reader: DocumentReader, node: Node): boolean {
	if (node.parentId === null) return false;
	return isStackContainer(reader.requireNode(node.parentId));
}

/** Alt+Shift+A over `ids`: every selected auto layout frame goes back to free placement. */
export function planRemoveAutoLayout(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const changes: Change[] = [];
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (!isStackContainer(node)) continue;
		const inStack = hasStackParent(reader, node);
		changes.push(
			...planSetProps(reader, id, {
				layoutMode: 'NONE',
				layoutWrap: 'NO_WRAP',
				layoutSizingHorizontal: frameSizing(node.layoutSizingHorizontal, inStack),
				layoutSizingVertical: frameSizing(node.layoutSizingVertical, inStack),
				primaryAxisSizingMode: 'FIXED',
				counterAxisSizingMode: 'FIXED'
			})
		);
		for (const child of reader.childNodes(id)) {
			if (!('layoutPositioning' in child)) continue;
			changes.push(
				...planSetProps(reader, child.id, {
					layoutPositioning: 'AUTO',
					layoutSizingHorizontal: childSizing(child.layoutSizingHorizontal),
					layoutSizingVertical: childSizing(child.layoutSizingVertical)
				})
			);
		}
	}
	return changes;
}
