// The pure core of `document.apply`: validate a change list against the store, apply it
// atomically (all or nothing) and return the normalized changes that were applied.
//
// Normalizing means `prev` values, `del` snapshots and move origins are re-read from the real
// state, never trusted from the caller. The inverse of the returned list is therefore always exact.
//
// Validation, in the order it runs:
//   per change, before it applies   structure: parent exists and may have children, pages are
//                                   roots, no move into its own subtree, protected keys untouched
//   after all changes               schema of every touched node and entity, instance main
//                                   exists, no component contains an instance of itself
//                                   (data-model.md section 7, "Cycle prevention")

import { invertChange } from './store';
import { assertValidParent, canHaveChildren } from './treeOps';
import {
	assetRecordSchema,
	nodeSchema,
	styleSchema,
	variableCollectionSchema,
	variableSchema
} from './schema';
import type { DocumentStore } from './store';
import type { Change, EntityKind, EntityMap, Node, NodeId } from './types';
import { ENTITY_KINDS } from './types';
import { z } from 'zod';

export class InvalidChangeError extends Error {
	constructor(
		readonly reason: string,
		/** Position in the rejected list, or -1 when the problem is only visible after all applied. */
		readonly changeIndex: number
	) {
		super(describeRejection(reason, changeIndex));
		this.name = 'InvalidChangeError';
	}
}

function describeRejection(reason: string, changeIndex: number): string {
	if (changeIndex < 0) return `invalid change: ${reason}`;
	return `invalid change #${changeIndex}: ${reason}`;
}

export class ComponentCycleError extends InvalidChangeError {
	constructor(
		readonly instanceId: NodeId,
		readonly componentId: NodeId
	) {
		super(`instance ${instanceId} would put component ${componentId} inside itself`, -1);
		this.name = 'ComponentCycleError';
	}
}

const ENTITY_SCHEMAS: Record<EntityKind, z.ZodType> = {
	style: styleSchema,
	variable: variableSchema,
	collection: variableCollectionSchema,
	asset: assetRecordSchema
};

const PROTECTED_NODE_KEYS = ['id', 'type', 'parentId', 'index'];

interface Touched {
	nodes: Set<NodeId>;
	entities: Map<string, { kind: EntityKind; id: string }>;
}

/**
 * Validate and apply `changes`. On any failure the store is left exactly as it was and an
 * `InvalidChangeError` (or a plain error from the store) is thrown.
 */
export function applyChanges(store: DocumentStore, changes: Change[]): Change[] {
	const applied: Change[] = [];
	const touched: Touched = { nodes: new Set(), entities: new Map() };
	try {
		changes.forEach((change, position) => {
			const normalized = normalizeChange(store, change, position);
			store.apply(normalized);
			applied.push(normalized);
			recordTouched(touched, normalized);
		});
		validateTouched(store, touched);
	} catch (error) {
		rollback(store, applied);
		throw error;
	}
	return applied;
}

/** Undo changes that were applied, newest first. */
export function rollback(store: DocumentStore, applied: Change[]): void {
	for (let position = applied.length - 1; position >= 0; position -= 1) {
		store.apply(invertChange(applied[position]));
	}
}

function recordTouched(touched: Touched, change: Change): void {
	switch (change.t) {
		case 'add':
		case 'del':
			touched.nodes.add(change.node.id);
			return;
		case 'set':
		case 'move':
			touched.nodes.add(change.id);
			return;
		case 'entity-add':
		case 'entity-del':
			touched.entities.set(`${change.kind}:${change.entity.id}`, {
				kind: change.kind,
				id: change.entity.id
			});
			return;
		case 'entity-set':
			touched.entities.set(`${change.kind}:${change.id}`, { kind: change.kind, id: change.id });
			return;
	}
}

// ---------- per-change normalization and structural checks ----------

function normalizeChange(store: DocumentStore, change: Change, position: number): Change {
	try {
		return normalizeUnchecked(store, change);
	} catch (error) {
		if (error instanceof InvalidChangeError) throw error;
		throw new InvalidChangeError(error instanceof Error ? error.message : String(error), position);
	}
}

function normalizeUnchecked(store: DocumentStore, change: Change): Change {
	switch (change.t) {
		case 'add':
			assertAddable(store, change.node);
			return change;
		case 'del':
			return { t: 'del', node: store.requireNode(change.node.id) };
		case 'set':
			return normalizeSet(store, change.id, change.set);
		case 'move':
			return normalizeMove(store, change.id, change.parent, change.index);
		case 'entity-add':
			return change;
		case 'entity-del':
			return {
				...change,
				entity: requireEntity(store, change.kind, change.entity.id)
			} as Change;
		case 'entity-set':
			return normalizeEntitySet(store, change.kind, change.id, change.set);
	}
}

function assertAddable(store: DocumentStore, node: Node): void {
	if (node.type === 'PAGE') {
		const pageParent: NodeId | null = node.parentId;
		if (pageParent !== null) throw new Error(`page ${node.id} must be a root`);
		return;
	}
	if (node.parentId === null) throw new Error(`only pages can be roots, not ${node.type}`);
	const parent = store.getNode(node.parentId);
	if (!parent) throw new Error(`parent not found: ${node.parentId}`);
	if (!canHaveChildren(parent.type)) {
		throw new Error(`${parent.type} ${parent.id} cannot have children`);
	}
}

function normalizeSet(store: DocumentStore, id: NodeId, set: Record<string, unknown>): Change {
	const node = store.requireNode(id);
	const protectedKey = Object.keys(set).find((key) => PROTECTED_NODE_KEYS.includes(key));
	if (protectedKey) {
		throw new Error(`cannot set "${protectedKey}" on ${id}; use a move change for position`);
	}
	return { t: 'set', id, set, prev: previousValues(node, set) };
}

function normalizeMove(
	store: DocumentStore,
	id: NodeId,
	parent: NodeId | null,
	index: string
): Change {
	const node = store.requireNode(id);
	assertValidParent(store, id, parent);
	return {
		t: 'move',
		id,
		parent,
		index,
		prevParent: node.parentId,
		prevIndex: node.index
	};
}

function normalizeEntitySet(
	store: DocumentStore,
	kind: EntityKind,
	id: string,
	set: Record<string, unknown>
): Change {
	const entity = requireEntity(store, kind, id);
	if (Object.hasOwn(set, 'id')) throw new Error(`cannot set "id" on ${kind} ${id}`);
	return { t: 'entity-set', kind, id, set, prev: previousValues(entity, set) } as Change;
}

function requireEntity(store: DocumentStore, kind: EntityKind, id: string): EntityMap[EntityKind] {
	if (!ENTITY_KINDS.includes(kind)) throw new Error(`unknown entity kind: ${kind}`);
	const entity = store.getEntity(kind, id);
	if (entity === undefined) throw new Error(`${kind} not found: ${id}`);
	return entity;
}

/** Current values of the keys in `set`; keys the target lacks map to `undefined` (removal). */
function previousValues(target: object, set: Record<string, unknown>): Record<string, unknown> {
	const previous: Record<string, unknown> = {};
	for (const key of Object.keys(set)) previous[key] = Reflect.get(target, key);
	return previous;
}

// ---------- post-apply validation ----------

function validateTouched(store: DocumentStore, touched: Touched): void {
	for (const id of touched.nodes) {
		const node = store.getNode(id);
		if (node) assertNodeValid(node);
	}
	for (const { kind, id } of touched.entities.values()) {
		const entity = store.getEntity(kind, id);
		if (entity !== undefined) assertEntityValid(kind, entity);
	}
	assertInstancesValid(store, touched.nodes);
}

function assertNodeValid(node: Node): void {
	const result = nodeSchema.safeParse(node);
	if (result.success) return;
	throw new InvalidChangeError(`${node.type} ${node.id}: ${z.prettifyError(result.error)}`, -1);
}

function assertEntityValid(kind: EntityKind, entity: unknown): void {
	const result = ENTITY_SCHEMAS[kind].safeParse(entity);
	if (result.success) return;
	throw new InvalidChangeError(`${kind}: ${z.prettifyError(result.error)}`, -1);
}

/** Instances in the touched nodes and below them: the ones whose enclosing components changed. */
function instancesAmong(store: DocumentStore, ids: Set<NodeId>): Node[] {
	const found = new Map<NodeId, Node>();
	for (const id of ids) {
		const node = store.getNode(id);
		if (!node) continue;
		for (const candidate of [node, ...store.descendants(id)]) {
			if (candidate.type === 'INSTANCE') found.set(candidate.id, candidate);
		}
	}
	return [...found.values()];
}

function assertInstancesValid(store: DocumentStore, touchedNodes: Set<NodeId>): void {
	for (const instance of instancesAmong(store, touchedNodes)) {
		if (instance.type !== 'INSTANCE') continue;
		const main = store.getNode(instance.mainComponentId);
		// A deleted main leaves its instances behind: they can restore it (planRestoreMain).
		if (!main) continue;
		if (main.type !== 'COMPONENT') {
			throw new InvalidChangeError(
				`instance ${instance.id} refers to ${instance.mainComponentId}, which is not a component`,
				-1
			);
		}
		assertNoComponentCycle(store, instance.id, instance.mainComponentId);
	}
}

/** Every main component reachable from `startId` through instances inside the mains. */
function reachableMains(store: DocumentStore, startId: NodeId): Set<NodeId> {
	const visited = new Set<NodeId>();
	const pending = [startId];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined || visited.has(current)) continue;
		visited.add(current);
		if (!store.hasNode(current)) continue;
		for (const inner of store.descendants(current)) {
			if (inner.type === 'INSTANCE') pending.push(inner.mainComponentId);
		}
	}
	return visited;
}

function assertNoComponentCycle(
	store: DocumentStore,
	instanceId: NodeId,
	mainComponentId: NodeId
): void {
	const reachable = reachableMains(store, mainComponentId);
	for (const ancestor of store.ancestors(instanceId)) {
		if (ancestor.type !== 'COMPONENT') continue;
		if (reachable.has(ancestor.id)) throw new ComponentCycleError(instanceId, ancestor.id);
	}
}
