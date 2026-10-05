// Planning for "Create component" (docs/research/interactions.md section 2): frames and groups
// become components in place, anything else is wrapped in a new component. Pure: reads a
// `DocumentReader`, returns changes.

import {
	cloneAsRecord,
	createNode,
	generateNodeId,
	isInsideInstance,
	isInsideMain,
	keyBetween,
	recordAsNode,
	type Change,
	type DocumentReader,
	type IdGenerator,
	type Node,
	type NodeId
} from '../document';
import { planWrap } from './grouping';
import { sortByDocumentOrder, topLevelIds } from './selectionOps';

export interface CreateComponentPlan {
	changes: Change[];
	/** The new components, in document order. */
	componentIds: NodeId[];
}

const CONVERTIBLE_TYPES: readonly string[] = ['FRAME', 'GROUP'];
const COMPONENT_ONLY_PROTECTED = ['id', 'type', 'parentId', 'index', 'key'];

/** Whether `node` can become, or be wrapped in, a component. */
export function canMakeComponent(reader: DocumentReader, node: Node): boolean {
	if (node.type === 'PAGE' || node.type === 'SLICE' || node.type === 'COMPONENT_SET') return false;
	if (node.type === 'COMPONENT') return false;
	if (isInsideInstance(reader, node)) return false;
	if (node.parentId === null) return false;
	const parent = reader.getNode(node.parentId);
	if (parent === undefined) return false;
	return !isInsideMain(reader, parent);
}

function indexAfter(reader: DocumentReader, node: Node): string {
	const siblings = reader.childNodes(node.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === node.id);
	const next = siblings[position + 1];
	if (next === undefined) return keyBetween(node.index, null);
	return keyBetween(node.index, next.index);
}

/** A component with the look of `node` (a frame or group) that takes its children. */
function planConvert(reader: DocumentReader, node: Node, componentId: NodeId): Change[] {
	if (node.parentId === null) return [];
	const component = createNode('COMPONENT', {
		id: componentId,
		parentId: node.parentId,
		index: indexAfter(reader, node)
	});
	const record = cloneAsRecord(component);
	const own = cloneAsRecord(node);
	for (const key of Object.keys(record)) {
		if (COMPONENT_ONLY_PROTECTED.includes(key) || !Object.hasOwn(own, key)) continue;
		record[key] = own[key];
	}
	if (node.type === 'GROUP') record.clipsContent = false;
	const changes: Change[] = [{ t: 'add', node: recordAsNode(record) }];
	for (const child of reader.childNodes(node.id)) {
		changes.push({
			t: 'move',
			id: child.id,
			parent: componentId,
			index: child.index,
			prevParent: node.id,
			prevIndex: child.index
		});
	}
	changes.push({ t: 'del', node });
	return changes;
}

/**
 * Components from the selection: when every selected layer is a frame or group each becomes its
 * own component (same look, same children); otherwise all of them are wrapped in one new
 * component sized to their bounds. Layers inside instances or other components are skipped.
 * Returns `null` when nothing can be made.
 */
export function planCreateComponents(
	reader: DocumentReader,
	ids: readonly NodeId[],
	idGenerator: IdGenerator = generateNodeId
): CreateComponentPlan | null {
	const eligible = sortByDocumentOrder(reader, topLevelIds(reader, ids)).filter((id) =>
		canMakeComponent(reader, reader.requireNode(id))
	);
	if (eligible.length === 0) return null;
	const nodes = eligible.map((id) => reader.requireNode(id));
	if (!nodes.every((node) => CONVERTIBLE_TYPES.includes(node.type))) {
		const wrapped = planWrap(reader, eligible, 'COMPONENT', idGenerator());
		if (wrapped === null) return null;
		return { changes: wrapped.changes, componentIds: [wrapped.wrapperId] };
	}
	const plan: CreateComponentPlan = { changes: [], componentIds: [] };
	for (const node of nodes) {
		const componentId = idGenerator();
		plan.changes.push(...planConvert(reader, node, componentId));
		plan.componentIds.push(componentId);
	}
	return plan;
}
