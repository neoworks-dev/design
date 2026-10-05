// Replacing the subtree of an instance with a copy of another main component: instance swap and
// variant switch. Touched groups carry over to nodes that match by name path; overrides without a
// match are dropped (data-model.md section 7, "Nested instance sync").

import { bindFreshLayers } from './componentBindings';
import { GROUP_KEYS, INSTANCE_ROOT_OWN_KEYS, touchedOf, trackedOnNode } from './componentGroups';
import { cloneCounterparts } from './components';
import { planRemove } from './changes';
import type { IdGenerator } from './ids';
import type { DocumentReader } from './store';
import type { Change, ComponentPropertyValue, Node, NodeId, TouchedGroup } from './types';

/**
 * Name paths of a subtree: `Card/Title#0/Label#1`. Same-named siblings are told apart by their
 * order, so the paths of old and new subtrees line up even with repeated layer names.
 */
export function namePaths(nodes: Node[], rootId: NodeId): Map<string, Node> {
	const byParent = new Map<NodeId, Node[]>();
	for (const node of nodes) {
		if (node.parentId === null || node.id === rootId) continue;
		const siblings = byParent.get(node.parentId);
		if (siblings === undefined) byParent.set(node.parentId, [node]);
		else siblings.push(node);
	}
	const paths = new Map<string, Node>();
	const visit = (parentId: NodeId, prefix: string): void => {
		const siblings = (byParent.get(parentId) ?? []).sort((left, right) =>
			left.index < right.index ? -1 : 1
		);
		const seen = new Map<string, number>();
		for (const sibling of siblings) {
			const occurrence = seen.get(sibling.name) ?? 0;
			seen.set(sibling.name, occurrence + 1);
			const path = `${prefix}/${sibling.name}#${occurrence}`;
			paths.set(path, sibling);
			visit(sibling.id, path);
		}
	};
	visit(rootId, '');
	return paths;
}

function groupValues(
	source: Node,
	groups: readonly TouchedGroup[],
	own: Node
): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const group of groups) {
		for (const key of GROUP_KEYS[group]) {
			if (!trackedOnNode(own, key)) continue;
			values[key] = structuredClone(Reflect.get(source, key));
		}
	}
	return values;
}

function assignValues(target: Node, values: Record<string, unknown>): void {
	const record = target as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) Reflect.deleteProperty(record, key);
		else record[key] = value;
	}
}

function carryNode(from: Node, to: Node): void {
	const groups = touchedOf(from);
	if (groups.length === 0 || from.type !== to.type) return;
	assignValues(to, groupValues(from, groups, to));
	to.touched = [...groups];
}

function carryProperties(
	old: Node,
	fresh: Record<string, ComponentPropertyValue>
): Record<string, ComponentPropertyValue> {
	if (old.type !== 'INSTANCE') return fresh;
	const carried = { ...fresh };
	for (const [key, value] of Object.entries(old.componentProperties)) {
		const current = fresh[key];
		if (current === undefined || current.type !== value.type || value.type === 'VARIANT') continue;
		carried[key] = value;
	}
	return carried;
}

/**
 * Replace instance `instanceId` by an instance of `mainId`, keeping its id, place and own
 * settings. Returns no changes when it already is an instance of `mainId`.
 */
export function planSwap(
	reader: DocumentReader,
	instanceId: NodeId,
	mainId: NodeId,
	idGenerator?: IdGenerator
): Change[] {
	const old = reader.requireNode(instanceId);
	if (old.type !== 'INSTANCE' || old.parentId === null) {
		throw new Error(`${instanceId} is not an instance`);
	}
	if (old.mainComponentId === mainId) return [];
	const clone = cloneCounterparts(reader, mainId, {
		parentId: old.parentId,
		index: old.index,
		idGenerator,
		asInstance: true,
		fixedIds: new Map([[mainId, old.id]])
	});
	const freshRoot = clone.nodes[0];
	if (freshRoot.type !== 'INSTANCE') throw new Error('swap target did not produce an instance');

	const oldNodes = [old, ...reader.descendants(old.id)];
	const oldPaths = namePaths(oldNodes, old.id);
	const freshPaths = namePaths(clone.nodes, freshRoot.id);
	for (const [path, oldNode] of oldPaths) {
		const freshNode = freshPaths.get(path);
		if (freshNode !== undefined) carryNode(oldNode, freshNode);
	}
	carryNode(old, freshRoot);
	assignValues(
		freshRoot,
		Object.fromEntries(
			INSTANCE_ROOT_OWN_KEYS.filter((key) => key !== 'componentProperties').map((key) => [
				key,
				Reflect.get(old, key)
			])
		)
	);
	freshRoot.componentProperties = carryProperties(old, freshRoot.componentProperties);
	bindFreshLayers(reader, clone.nodes, freshRoot.componentProperties);
	if (old.componentRef !== undefined) freshRoot.componentRef = old.componentRef;
	if (old.touched !== undefined) freshRoot.touched = [...old.touched];

	return [...planRemove(reader, old.id), ...clone.changes];
}
