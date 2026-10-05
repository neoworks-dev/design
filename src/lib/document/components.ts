// The component sync engine (data-model.md section 2, provisional answers in section 7).
//
// Instances are materialized copies: every node inside an instance is a real node whose
// `componentRef` names its counterpart in the main component (a nested instance's counterpart is
// the node it was copied from, so counterparts chain: instance -> outer main -> inner main).
// The root of an instance stores `mainComponentId` instead. `touched` lists the property groups
// the instance overrides.
//
// Everything here is a planner: it reads the store and returns changes, never mutates.
//   markTouched      user edits to an instance node add the matching groups to `touched`
//   planMainSync     a change to a main component becomes changes to its counterparts
//   cloneCounterparts  copy a main (sub)tree as instance nodes with fresh ids

import {
	counterpartIdOf,
	groupOfProperty,
	groupsOfSet,
	isKeyOverridden,
	touchedOf,
	trackedOnNode
} from './componentGroups';
import { defaultPropertyValues, variantSetOf } from './componentDefinitions';
import { planRemove, planSetProps } from './changes';
import { generateNodeId, type IdGenerator } from './ids';
import type { DocumentReader } from './store';
import type {
	Change,
	ComponentPropertyValue,
	Node,
	NodeChange,
	NodeId,
	TouchedGroup
} from './types';

/** Counterpart id to the nodes that are copies of it. */
export type CounterpartIndex = Map<NodeId, Node[]>;

export function buildCounterpartIndex(reader: DocumentReader): CounterpartIndex {
	const index: CounterpartIndex = new Map();
	for (const node of Object.values(reader.nodes)) {
		const counterpartId = counterpartIdOf(node);
		if (counterpartId === undefined) continue;
		const copies = index.get(counterpartId);
		if (copies === undefined) index.set(counterpartId, [node]);
		else copies.push(node);
	}
	return index;
}

// ---------- structure helpers ----------

/** The nearest component at or above `node`: the main whose tree it belongs to. */
export function enclosingMain(reader: DocumentReader, node: Node): Node | undefined {
	let current: Node | undefined = node;
	while (current !== undefined) {
		if (current.type === 'COMPONENT') return current;
		if (current.parentId === null) return undefined;
		current = reader.getNode(current.parentId);
	}
	return undefined;
}

/** Whether `node` is a component or sits somewhere inside one. */
export function isInsideMain(reader: DocumentReader, node: Node): boolean {
	return enclosingMain(reader, node) !== undefined;
}

/** Whether `node` is inside an instance (it, or an ancestor, has a counterpart). */
export function isInsideInstance(reader: DocumentReader, node: Node): boolean {
	let current: Node | undefined = node;
	while (current !== undefined) {
		if (counterpartIdOf(current) !== undefined) return true;
		if (current.parentId === null) return false;
		current = reader.getNode(current.parentId);
	}
	return false;
}

/**
 * The instance a counterpart node belongs to: the nearest instance at or above it whose main is
 * the component its counterpart lives in. For nodes of a nested instance that is the outer
 * instance, not the nested one.
 */
export function containerOf(reader: DocumentReader, node: Node): NodeId | undefined {
	const counterpartId = counterpartIdOf(node);
	if (counterpartId === undefined) return undefined;
	const counterpart = reader.getNode(counterpartId);
	if (counterpart === undefined) return undefined;
	const main = enclosingMain(reader, counterpart);
	if (main === undefined) return undefined;
	let current: Node | undefined = node;
	while (current !== undefined) {
		if (current.type === 'INSTANCE' && current.mainComponentId === main.id) return current.id;
		if (current.parentId === null) return undefined;
		current = reader.getNode(current.parentId);
	}
	return undefined;
}

/** The node inside `containerId` that is the copy of `targetId`, or the container itself. */
export function findCopyIn(
	reader: DocumentReader,
	containerId: NodeId,
	targetId: NodeId
): Node | undefined {
	const container = reader.getNode(containerId);
	if (container === undefined) return undefined;
	if (container.type === 'INSTANCE' && container.mainComponentId === targetId) return container;
	for (const descendant of reader.descendants(containerId)) {
		if (counterpartIdOf(descendant) !== targetId) continue;
		if (containerOf(reader, descendant) === containerId) return descendant;
	}
	return undefined;
}

/** Walk the counterpart chain from `node` until it reaches a node of the main `mainId`. */
export function nodeInMain(reader: DocumentReader, node: Node, mainId: NodeId): Node | undefined {
	let current: Node | undefined = node;
	for (let step = 0; step < 32 && current !== undefined; step += 1) {
		const counterpartId = counterpartIdOf(current);
		if (counterpartId === undefined) return undefined;
		const counterpart = reader.getNode(counterpartId);
		if (counterpart === undefined) return undefined;
		const main = enclosingMain(reader, counterpart);
		if (main !== undefined && main.id === mainId) return counterpart;
		current = counterpart;
	}
	return undefined;
}

// ---------- touch tracking ----------

function unionGroups(
	current: readonly TouchedGroup[],
	added: readonly TouchedGroup[]
): TouchedGroup[] {
	const merged = [...current];
	for (const group of added) {
		if (!merged.includes(group)) merged.push(group);
	}
	return merged;
}

function previousValues(node: Node, set: Record<string, unknown>): Record<string, unknown> {
	const previous: Record<string, unknown> = {};
	for (const key of Object.keys(set)) previous[key] = Reflect.get(node, key);
	return previous;
}

/**
 * User edits to a node that is a copy of a main component record the overridden groups in the
 * same `set`, so the override and the mark land together. A `set` that already carries `touched`
 * (reset, push, swap) says what it means and is left alone.
 */
export function markTouched(reader: DocumentReader, changes: Change[]): Change[] {
	const pending = new Map<NodeId, TouchedGroup[]>();
	return changes.map((change) => {
		if (change.t !== 'set' || Object.hasOwn(change.set, 'touched')) return change;
		const node = reader.getNode(change.id);
		if (node === undefined || counterpartIdOf(node) === undefined) return change;
		const groups = groupsOfSet(node, change.set, previousValues(node, change.set));
		const current = pending.get(node.id) ?? touchedOf(node);
		const next = unionGroups(current, groups);
		if (next.length === current.length) return change;
		pending.set(node.id, next);
		return { ...change, set: { ...change.set, touched: next } };
	});
}

// ---------- cloning a main as instance nodes ----------

const COMPONENT_ONLY_KEYS = [
	'key',
	'description',
	'componentPropertyDefinitions',
	'variantProperties'
];

export interface CloneCounterpartsOptions {
	parentId: NodeId;
	/** Fractional index of the cloned root among its new siblings. */
	index: string;
	idGenerator?: IdGenerator;
	/**
	 * Make the root an instance of the source (which must be a component): it gets
	 * `mainComponentId` and `componentProperties` instead of a `componentRef`.
	 */
	asInstance?: boolean;
	/** Ids to use instead of generated ones, by source id (restoring a deleted main). */
	fixedIds?: Map<NodeId, NodeId>;
}

export interface CounterpartClone {
	rootId: NodeId;
	/** Parents before children. */
	nodes: Node[];
	changes: NodeChange[];
}

function stripToFrame(copy: Node): Node {
	const record = copy as unknown as Record<string, unknown>;
	for (const key of COMPONENT_ONLY_KEYS) Reflect.deleteProperty(record, key);
	record.type = 'FRAME';
	return record as unknown as Node;
}

function copyOf(original: Node, newId: NodeId, mapped: Map<NodeId, NodeId>): Node {
	let copy = structuredClone(original);
	Reflect.deleteProperty(copy, 'componentPropertyReferences');
	if (copy.type === 'COMPONENT' || copy.type === 'COMPONENT_SET') copy = stripToFrame(copy);
	copy.id = newId;
	copy.componentRef = original.id;
	copy.touched = [];
	const parent = copy.parentId === null ? undefined : mapped.get(copy.parentId);
	if (parent !== undefined) copy.parentId = parent;
	return copy;
}

function makeInstanceRoot(
	reader: DocumentReader,
	source: Node,
	copy: Node,
	options: CloneCounterpartsOptions
): Node {
	const record = copy as unknown as Record<string, unknown>;
	for (const key of COMPONENT_ONLY_KEYS) Reflect.deleteProperty(record, key);
	Reflect.deleteProperty(record, 'componentRef');
	record.type = 'INSTANCE';
	record.mainComponentId = source.id;
	record.componentProperties = defaultPropertyValues(reader, source.id);
	record.touched = [];
	record.parentId = options.parentId;
	record.index = options.index;
	const set = variantSetOf(reader, source.id);
	if (set !== undefined) record.name = set.name;
	return record as unknown as Node;
}

/**
 * Copy `sourceId` and everything below it as instance nodes under `options.parentId`. Every copy
 * gets a fresh id, `componentRef` to its original and an empty `touched`. With `asInstance` the
 * root becomes an instance of the source component.
 */
export function cloneCounterparts(
	reader: DocumentReader,
	sourceId: NodeId,
	options: CloneCounterpartsOptions
): CounterpartClone {
	const generate = options.idGenerator === undefined ? generateNodeId : options.idGenerator;
	const source = reader.requireNode(sourceId);
	const originals = [source, ...reader.descendants(sourceId)];
	const ids = new Map<NodeId, NodeId>();
	for (const original of originals) {
		const fixed = options.fixedIds?.get(original.id);
		ids.set(original.id, fixed === undefined ? generate() : fixed);
	}
	const mapped = (id: NodeId): NodeId => {
		const found = ids.get(id);
		if (found === undefined) throw new Error(`id not in clone map: ${id}`);
		return found;
	};
	const nodes = originals.map((original) => {
		const copy = copyOf(original, mapped(original.id), ids);
		if (original.id !== sourceId) return copy;
		if (options.asInstance === true) return makeInstanceRoot(reader, source, copy, options);
		copy.parentId = options.parentId;
		copy.index = options.index;
		return copy;
	});
	const changes: NodeChange[] = nodes.map((node) => ({ t: 'add', node }));
	return { rootId: mapped(sourceId), nodes, changes };
}

// ---------- propagation from a main to its copies ----------

function mergedBoundVariables(source: Node, copy: Node): unknown {
	const wanted: Record<string, unknown> = { ...source.boundVariables };
	const own: Record<string, unknown> = { ...copy.boundVariables };
	const merged: Record<string, unknown> = {};
	for (const key of new Set([...Object.keys(wanted), ...Object.keys(own)])) {
		const group = groupOfProperty(key);
		const overridden = group !== undefined && copy.touched?.includes(group) === true;
		let value = wanted[key];
		if (overridden) value = own[key];
		if (value !== undefined) merged[key] = value;
	}
	return merged;
}

/** The properties of `source` that `copy` should take: those whose group `copy` has not touched. */
export function syncedProperties(
	source: Node,
	copy: Node,
	keys: string[]
): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const key of keys) {
		if (key === 'boundVariables') {
			props.boundVariables = mergedBoundVariables(source, copy);
			continue;
		}
		if (!trackedOnNode(copy, key)) continue;
		if (groupOfProperty(key) === undefined) continue;
		if (isKeyOverridden(copy, key)) continue;
		props[key] = structuredClone(Reflect.get(source, key));
	}
	return props;
}

function planSetSync(reader: DocumentReader, index: CounterpartIndex, change: Change): Change[] {
	if (change.t !== 'set') return [];
	const source = reader.getNode(change.id);
	if (source === undefined) return [];
	const copies = index.get(source.id);
	if (copies === undefined) return [];
	let keys = Object.keys(change.set);
	// A variant is named after its properties; its instances are named after the set.
	if (source.type === 'COMPONENT' && variantSetOf(reader, source.id) !== undefined) {
		keys = keys.filter((key) => key !== 'name');
	}
	const out: Change[] = [];
	for (const copy of copies) {
		const props = syncedProperties(source, copy, keys);
		out.push(...planSetProps(reader, copy.id, props));
	}
	return out;
}

function planAddSync(
	reader: DocumentReader,
	index: CounterpartIndex,
	added: Node,
	idGenerator: IdGenerator
): Change[] {
	if (added.parentId === null) return [];
	const out: Change[] = [];
	for (const parentCopy of index.get(added.parentId) ?? []) {
		const already = reader
			.childNodes(parentCopy.id)
			.some((child) => child.componentRef === added.id);
		if (already) continue;
		const clone = cloneCounterparts(reader, added.id, {
			parentId: parentCopy.id,
			index: added.index,
			idGenerator
		});
		out.push(...clone.changes);
	}
	return out;
}

function planDelSync(
	reader: DocumentReader,
	index: CounterpartIndex,
	deleted: Node,
	removed: Set<NodeId>
): Change[] {
	if (deleted.type === 'COMPONENT') return [];
	const out: Change[] = [];
	for (const copy of index.get(deleted.id) ?? []) {
		if (removed.has(copy.id) || !reader.hasNode(copy.id)) continue;
		for (const change of planRemove(reader, copy.id)) {
			if (change.t !== 'del' || removed.has(change.node.id)) continue;
			removed.add(change.node.id);
			out.push(change);
		}
	}
	return out;
}

function planMoveSync(
	reader: DocumentReader,
	index: CounterpartIndex,
	change: Change,
	removed: Set<NodeId>
): Change[] {
	if (change.t !== 'move') return [];
	const source = reader.getNode(change.id);
	if (source === undefined || source.type === 'COMPONENT' || change.parent === null) return [];
	const out: Change[] = [];
	for (const copy of index.get(source.id) ?? []) {
		const containerId = containerOf(reader, copy);
		if (containerId === undefined || removed.has(copy.id)) continue;
		const parentCopy = findCopyIn(reader, containerId, change.parent);
		if (parentCopy === undefined) {
			out.push(...planLeaveSync(reader, change.parent, copy, removed));
			continue;
		}
		if (copy.parentId === parentCopy.id && copy.index === change.index) continue;
		if (copy.id === parentCopy.id) continue;
		out.push({
			t: 'move',
			id: copy.id,
			parent: parentCopy.id,
			index: change.index,
			prevParent: copy.parentId,
			prevIndex: copy.index
		});
	}
	return out;
}

/** A layer moved out of every component: its copies go. Moved elsewhere inside: they stay. */
function planLeaveSync(
	reader: DocumentReader,
	newParentId: NodeId,
	copy: Node,
	removed: Set<NodeId>
): Change[] {
	const newParent = reader.getNode(newParentId);
	if (newParent === undefined || isInsideMain(reader, newParent)) return [];
	const out: Change[] = [];
	for (const change of planRemove(reader, copy.id)) {
		if (change.t !== 'del' || removed.has(change.node.id)) continue;
		removed.add(change.node.id);
		out.push(change);
	}
	return out;
}

/** Whether `change` touches a node that is, or sits in, a main component: copies may exist. */
function mayHaveCounterparts(reader: DocumentReader, change: Change): boolean {
	if (change.t !== 'add' && change.t !== 'del' && change.t !== 'set' && change.t !== 'move') {
		return false;
	}
	const node = change.t === 'add' || change.t === 'del' ? change.node : reader.getNode(change.id);
	if (node === undefined) return false;
	if (node.type === 'COMPONENT') return true;
	if (node.parentId === null) return false;
	const parent = reader.getNode(node.parentId);
	if (parent === undefined) return false;
	return isInsideMain(reader, parent);
}

/**
 * Changes that bring the copies of every changed main node in line, skipping touched groups.
 * `applied` is what was just applied; the store already reflects it. Layers added together with
 * their parent are covered by the parent's clone.
 */
export function planMainSync(
	reader: DocumentReader,
	applied: Change[],
	idGenerator: IdGenerator = generateNodeId
): Change[] {
	if (!applied.some((change) => mayHaveCounterparts(reader, change))) return [];
	const index = buildCounterpartIndex(reader);
	const addedIds = new Set<NodeId>();
	for (const change of applied) {
		if (change.t === 'add') addedIds.add(change.node.id);
	}
	const removed = new Set<NodeId>();
	const out: Change[] = [];
	for (const change of applied) {
		if (!mayHaveCounterparts(reader, change)) continue;
		switch (change.t) {
			case 'set':
				out.push(...planSetSync(reader, index, change));
				break;
			case 'add':
				if (change.node.parentId !== null && addedIds.has(change.node.parentId)) break;
				if (!reader.hasNode(change.node.id)) break;
				out.push(...planAddSync(reader, index, change.node, idGenerator));
				break;
			case 'del':
				out.push(...planDelSync(reader, index, change.node, removed));
				break;
			case 'move':
				out.push(...planMoveSync(reader, index, change, removed));
				break;
			default:
				break;
		}
	}
	return out;
}

/** Values of the instance's own component properties, by key (for tests and the inspector). */
export function propertyValuesOf(node: Node): Record<string, ComponentPropertyValue> {
	if (node.type !== 'INSTANCE') return {};
	return node.componentProperties;
}
