// Planners for the component lifecycle on instances: create an instance, detach, reset overrides,
// push overrides to the main component, restore a deleted main. Each reads the store and returns
// changes for one `document.apply`; the sync engine (components.ts) does the rest.

import { keyBetween } from './fractionalIndex';
import {
	cloneAsRecord,
	counterpartIdOf,
	GROUP_KEYS,
	groupOfProperty,
	recordAsNode,
	touchedOf,
	trackedOnNode
} from './componentGroups';
import { defaultPropertyValues } from './componentDefinitions';
import { cloneCounterparts, enclosingMain } from './components';
import { namePaths } from './componentSwap';
import { planSetProps, valuesEqual } from './changes';
import { generateNodeId, type IdGenerator } from './ids';
import { translationMatrix } from './matrix';
import type { DocumentReader } from './store';
import type {
	Change,
	ComponentPropertyValue,
	Matrix2x3,
	Node,
	NodeId,
	TouchedGroup
} from './types';

// ---------- create instance ----------

export interface InstancePlan {
	rootId: NodeId;
	changes: Change[];
}

export interface CreateInstanceOptions {
	parentId?: NodeId;
	index?: string;
	transform?: Matrix2x3;
	idGenerator?: IdGenerator;
}

function indexAfter(reader: DocumentReader, node: Node): string {
	const siblings = reader.childNodes(node.parentId);
	const position = siblings.findIndex((sibling) => sibling.id === node.id);
	const next = siblings[position + 1];
	if (next === undefined) return keyBetween(node.index, null);
	return keyBetween(node.index, next.index);
}

/** Where an instance of `main` goes by default: right of the main, outside any variant set. */
function defaultPlacement(
	reader: DocumentReader,
	main: Node
): { parentId: NodeId; index: string; transform: Matrix2x3 } {
	let anchor = main;
	const parent = main.parentId === null ? undefined : reader.getNode(main.parentId);
	if (parent !== undefined && parent.type === 'COMPONENT_SET') anchor = parent;
	if (anchor.parentId === null || !('transform' in anchor))
		throw new Error('component has no parent');
	const [[a, c, e], [b, d, f]] = anchor.transform;
	const transform: Matrix2x3 = [
		[a, c, e + anchor.width + 40],
		[b, d, f]
	];
	return { parentId: anchor.parentId, index: indexAfter(reader, anchor), transform };
}

/** An instance of `mainId`, beside the main unless `options` say where. */
export function planCreateInstance(
	reader: DocumentReader,
	mainId: NodeId,
	options: CreateInstanceOptions = {}
): InstancePlan {
	const main = reader.requireNode(mainId);
	if (main.type !== 'COMPONENT') throw new Error(`${mainId} is not a component`);
	const placement = defaultPlacement(reader, main);
	const clone = cloneCounterparts(reader, mainId, {
		parentId: options.parentId === undefined ? placement.parentId : options.parentId,
		index: options.index === undefined ? placement.index : options.index,
		idGenerator: options.idGenerator,
		asInstance: true
	});
	const [root] = clone.nodes;
	if (root.type === 'INSTANCE') {
		root.transform = options.transform === undefined ? placement.transform : options.transform;
	}
	return { rootId: clone.rootId, changes: clone.changes };
}

// ---------- detach ----------

function unionGroups(
	left: readonly TouchedGroup[] | undefined,
	right: readonly TouchedGroup[] | undefined
): TouchedGroup[] {
	return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function counterpartOf(reader: DocumentReader, node: Node): Node | undefined {
	const id = counterpartIdOf(node);
	if (id === undefined) return undefined;
	return reader.getNode(id);
}

interface DetachContext {
	reader: DocumentReader;
	changes: Change[];
}

/**
 * Descendants of a detached instance: plain nodes become plain; nested instances keep their own
 * link to their main (chain step: the counterpart's counterpart), with the overrides they had
 * against the outer main folded in.
 */
function detachDescendants(context: DetachContext, parent: Node, insideNested: boolean): void {
	for (const child of context.reader.childNodes(parent.id)) {
		const counterpart = counterpartOf(context.reader, child);
		if (insideNested) {
			const props: Record<string, unknown> = {
				touched: unionGroups(child.touched, counterpart?.touched)
			};
			if (counterpart?.componentRef !== undefined) props.componentRef = counterpart.componentRef;
			context.changes.push(...planSetProps(context.reader, child.id, props));
			detachDescendants(context, child, true);
			continue;
		}
		if (child.type === 'INSTANCE') {
			const touched = unionGroups(child.touched, counterpart?.touched);
			context.changes.push(
				...planSetProps(context.reader, child.id, { componentRef: undefined, touched })
			);
			detachDescendants(context, child, true);
			continue;
		}
		context.changes.push(
			...planSetProps(context.reader, child.id, { componentRef: undefined, touched: undefined })
		);
		detachDescendants(context, child, false);
	}
}

export interface DetachPlan {
	changes: Change[];
	/** Instance id to the frame that replaced it. */
	frameIds: Map<NodeId, NodeId>;
}

/** The nearest instance at or above `id` (a layer inside an instance detaches its instance). */
export function instanceOf(reader: DocumentReader, id: NodeId): Node | undefined {
	let current: Node | undefined = reader.getNode(id);
	while (current !== undefined) {
		if (current.type === 'INSTANCE') return current;
		if (current.parentId === null) return undefined;
		current = reader.getNode(current.parentId);
	}
	return undefined;
}

function detachFrame(instance: Node, frameId: NodeId, index: string): Node {
	const record = cloneAsRecord(instance);
	for (const key of ['mainComponentId', 'componentProperties', 'componentRef', 'touched']) {
		Reflect.deleteProperty(record, key);
	}
	record.type = 'FRAME';
	record.id = frameId;
	record.index = index;
	return recordAsNode(record);
}

/**
 * Turn the instances containing `ids` into plain frames with the same look. The frame is a new
 * node that takes the instance's place; layers below it are moved over, not copied.
 */
export function planDetach(
	reader: DocumentReader,
	ids: readonly NodeId[],
	idGenerator: IdGenerator = generateNodeId
): DetachPlan {
	const instances = new Map<NodeId, Node>();
	for (const id of ids) {
		const instance = instanceOf(reader, id);
		if (instance !== undefined) instances.set(instance.id, instance);
	}
	const outermost = [...instances.values()].filter(
		(instance) => !reader.ancestors(instance.id).some((ancestor) => instances.has(ancestor.id))
	);
	const plan: DetachPlan = { changes: [], frameIds: new Map() };
	for (const instance of outermost) detachOne(reader, instance, idGenerator, plan);
	return plan;
}

function detachOne(
	reader: DocumentReader,
	instance: Node,
	idGenerator: IdGenerator,
	plan: DetachPlan
): void {
	if (instance.parentId === null) return;
	const frameId = idGenerator();
	plan.frameIds.set(instance.id, frameId);
	plan.changes.push({
		t: 'add',
		node: detachFrame(instance, frameId, indexAfter(reader, instance))
	});
	const context: DetachContext = { reader, changes: plan.changes };
	detachDescendants(context, instance, false);
	for (const child of reader.childNodes(instance.id)) {
		plan.changes.push({
			t: 'move',
			id: child.id,
			parent: frameId,
			index: child.index,
			prevParent: instance.id,
			prevIndex: child.index
		});
	}
	plan.changes.push({ t: 'del', node: instance });
}

// ---------- reset and push overrides ----------

function overriddenNodes(reader: DocumentReader, ids: readonly NodeId[]): Node[] {
	const seen = new Map<NodeId, Node>();
	for (const id of ids) {
		const root = reader.getNode(id);
		if (root === undefined) continue;
		for (const node of [root, ...reader.descendants(id)]) seen.set(node.id, node);
	}
	return [...seen.values()];
}

function groupProps(
	source: Node,
	target: Node,
	groups: readonly TouchedGroup[]
): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const group of groups) {
		for (const key of GROUP_KEYS[group]) {
			if (!trackedOnNode(target, key)) continue;
			props[key] = structuredClone(Reflect.get(source, key));
		}
	}
	return props;
}

function boundVariablesAfter(
	take: Node,
	keep: Node,
	groups: readonly TouchedGroup[]
): Record<string, unknown> | undefined {
	const taken: Record<string, unknown> = { ...take.boundVariables };
	const kept: Record<string, unknown> = { ...keep.boundVariables };
	const result: Record<string, unknown> = {};
	for (const key of new Set([...Object.keys(taken), ...Object.keys(kept)])) {
		const group = groupOfProperty(key);
		const fromTake = group !== undefined && groups.includes(group);
		const value = fromTake ? taken[key] : kept[key];
		if (value !== undefined) result[key] = structuredClone(value);
	}
	if (Object.keys(result).length === 0) return undefined;
	return result;
}

function propertyDefaultsFor(reader: DocumentReader, node: Node): Record<string, unknown> {
	if (node.type !== 'INSTANCE' || node.componentRef !== undefined) return {};
	const defaults = defaultPropertyValues(reader, node.mainComponentId);
	const reset: Record<string, ComponentPropertyValue> = { ...node.componentProperties };
	for (const [key, value] of Object.entries(defaults)) {
		if (value.type === 'VARIANT' || reset[key] === undefined) continue;
		reset[key] = value;
	}
	return { componentProperties: reset };
}

/**
 * Clear the overrides of `ids` and everything below them: each touched group takes the value of
 * the counterpart again. An instance root also gets its component properties back to defaults.
 */
export function planResetOverrides(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const changes: Change[] = [];
	for (const node of overriddenNodes(reader, ids)) {
		const counterpart = counterpartOf(reader, node);
		if (counterpart === undefined) continue;
		const groups = touchedOf(node);
		const props: Record<string, unknown> = { ...propertyDefaultsFor(reader, node) };
		if (groups.length > 0) {
			Object.assign(props, groupProps(counterpart, node, groups));
			props.boundVariables = boundVariablesAfter(counterpart, node, groups);
			props.touched = [];
		}
		changes.push(...planSetProps(reader, node.id, props));
	}
	return changes;
}

/**
 * Write the overrides of `ids` (and below) into their counterparts in the main component and
 * clear them on the instance. The sync engine then updates the other instances.
 */
export function planPushOverrides(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const changes: Change[] = [];
	for (const node of overriddenNodes(reader, ids)) {
		const counterpart = counterpartOf(reader, node);
		const groups = touchedOf(node);
		if (counterpart === undefined || groups.length === 0) continue;
		const props = groupProps(node, node, groups);
		props.boundVariables = boundVariablesAfter(node, counterpart, groups);
		changes.push(...planSetProps(reader, counterpart.id, props));
		changes.push(...planSetProps(reader, node.id, { touched: [] }));
	}
	return changes;
}

/** Whether `node` overrides something against its counterpart. */
export function hasOverrides(node: Node): boolean {
	return node.touched !== undefined && node.touched.length > 0;
}

/** Nodes at or below `id` that carry overrides. */
export function overriddenBelow(reader: DocumentReader, id: NodeId): Node[] {
	return overriddenNodes(reader, [id]).filter(hasOverrides);
}

// ---------- restore a deleted main ----------

function differingGroups(from: Node, against: Node): TouchedGroup[] {
	const groups: TouchedGroup[] = [];
	for (const [name, keys] of Object.entries(GROUP_KEYS)) {
		const different = keys.some((key) => {
			if (!trackedOnNode(from, key)) return false;
			return !valuesEqual(Reflect.get(from, key), Reflect.get(against, key));
		});
		if (different) groups.push(name as TouchedGroup);
	}
	return groups;
}

/** Restored main node for instance node `source`: same look, fresh `componentRef` bookkeeping. */
function mainCopyOf(source: Node, id: NodeId, parentId: NodeId): Node {
	const record = cloneAsRecord(source);
	record.id = id;
	record.parentId = parentId;
	Reflect.deleteProperty(record, 'touched');
	Reflect.deleteProperty(record, 'componentRef');
	return recordAsNode(record);
}

/**
 * Rebuild the deleted main component of `instanceId` from the instance: a component with the
 * missing id and a copy of the instance's layers whose ids are the instance layers'
 * `componentRef`s, so every instance of it lines up again. It lands beside the instance, on the
 * page. Overrides inside nested instances become the restored main's own.
 */
export function planRestoreMain(
	reader: DocumentReader,
	instanceId: NodeId,
	idGenerator: IdGenerator = generateNodeId
): InstancePlan {
	const instance = reader.requireNode(instanceId);
	if (instance.type !== 'INSTANCE') throw new Error(`${instanceId} is not an instance`);
	if (reader.hasNode(instance.mainComponentId)) throw new Error('main component still exists');
	const mainId = instance.mainComponentId;
	const page = reader.pageOf(instanceId);
	const bounds = reader.cache.absoluteBounds(instanceId);
	const root = cloneAsRecord(mainCopyOf(instance, mainId, page.id));
	for (const key of ['mainComponentId', 'componentProperties']) Reflect.deleteProperty(root, key);
	root.type = 'COMPONENT';
	root.key = mainId;
	root.description = '';
	root.componentPropertyDefinitions = {};
	root.index = keyBetween(lastIndex(reader, page.id), null);
	root.transform = translationMatrix(bounds.x + bounds.width + 100, bounds.y);
	const changes: Change[] = [{ t: 'add', node: recordAsNode(root) }];
	restoreChildren(reader, instance, mainId, changes, idGenerator);
	return { rootId: mainId, changes };
}

function lastIndex(reader: DocumentReader, parentId: NodeId): string | null {
	const last = reader.childNodes(parentId).at(-1);
	if (last === undefined) return null;
	return last.index;
}

function restoreChildren(
	reader: DocumentReader,
	instance: Node,
	mainId: NodeId,
	changes: Change[],
	idGenerator: IdGenerator
): void {
	const restoredIds = new Map<NodeId, NodeId>([[instance.id, mainId]]);
	const pending: { node: Node; nested: boolean }[] = reader
		.childNodes(instance.id)
		.map((node) => ({ node, nested: false }));
	while (pending.length > 0) {
		const entry = pending.shift();
		if (entry === undefined) break;
		const { node, nested } = entry;
		const parentId = restoredIds.get(node.parentId ?? '');
		if (parentId === undefined) continue;
		if (node.type === 'INSTANCE' && !nested) {
			restoreNested(reader, node, parentId, changes, idGenerator);
			continue;
		}
		const wanted = node.componentRef;
		const id = wanted !== undefined && !reader.hasNode(wanted) ? wanted : idGenerator();
		restoredIds.set(node.id, id);
		changes.push({ t: 'add', node: mainCopyOf(node, id, parentId) });
		if (id !== wanted) changes.push(...planSetProps(reader, node.id, { componentRef: id }));
		for (const child of reader.childNodes(node.id)) pending.push({ node: child, nested });
	}
}

/**
 * A nested instance of the instance being restored: its main still exists, so the copy in the
 * restored main is a fresh instance of it, given the look of the nested one. The nested one's
 * layers are re-linked to the fresh layers, matched by name path.
 */
function restoreNested(
	reader: DocumentReader,
	nested: Node,
	parentId: NodeId,
	changes: Change[],
	idGenerator: IdGenerator
): void {
	if (nested.type !== 'INSTANCE') return;
	const wanted = nested.componentRef;
	const rootId = wanted !== undefined && !reader.hasNode(wanted) ? wanted : idGenerator();
	if (!reader.hasNode(nested.mainComponentId)) return;
	const clone = cloneCounterparts(reader, nested.mainComponentId, {
		parentId,
		index: nested.index,
		idGenerator,
		asInstance: true,
		fixedIds: new Map([[nested.mainComponentId, rootId]])
	});
	const oldPaths = namePaths([nested, ...reader.descendants(nested.id)], nested.id);
	const freshPaths = namePaths(clone.nodes, rootId);
	for (const [path, old] of oldPaths) {
		const fresh = freshPaths.get(path);
		if (fresh === undefined) continue;
		const touched = differingGroups(old, fresh);
		const values = groupProps(old, fresh, touched);
		Object.assign(fresh, values);
		fresh.touched = touched;
		changes.push(...planSetProps(reader, old.id, { componentRef: fresh.id, touched: [] }));
	}
	const [freshRoot] = clone.nodes;
	Object.assign(freshRoot, groupProps(nested, freshRoot, differingGroups(nested, freshRoot)));
	freshRoot.touched = differingGroups(nested, freshRoot);
	if (freshRoot.type === 'INSTANCE' && nested.type === 'INSTANCE') {
		freshRoot.componentProperties = structuredClone(nested.componentProperties);
	}
	changes.push(...clone.changes);
	changes.push(...planSetProps(reader, nested.id, { componentRef: rootId, touched: [] }));
}

/** The enclosing main component of `id` (the one its layer belongs to), for the inspector. */
export function mainOfLayer(reader: DocumentReader, id: NodeId): Node | undefined {
	const node = reader.getNode(id);
	if (node === undefined) return undefined;
	return enclosingMain(reader, node);
}
