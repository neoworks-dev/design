// Builders that turn intent into change lists (data-model.md section 5). They read the store for
// `prev` values and snapshots, and never mutate. `document.apply` recomputes `prev` and snapshots
// from the real state anyway, so a hand-written change cannot corrupt the inverse; these helpers
// exist so callers do not have to.

import { planMove } from './treeOps';
import type { DocumentStore } from './store';
import type { Change, EntityChange, EntityKind, EntityMap, Node, NodeId } from './types';

export function valuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== 'object' || typeof right !== 'object') return false;
	if (left === null || right === null) return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	if (leftKeys.length !== Object.keys(rightRecord).length) return false;
	return leftKeys.every(
		(key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key])
	);
}

function changedProperties(
	current: object,
	props: Record<string, unknown>
): { set: Record<string, unknown>; prev: Record<string, unknown> } {
	const set: Record<string, unknown> = {};
	const prev: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(props)) {
		const existing: unknown = Reflect.get(current, key);
		if (valuesEqual(existing, value)) continue;
		set[key] = value;
		prev[key] = existing;
	}
	return { set, prev };
}

/** Property-level `set` of top-level keys; keys that already hold the value are left out. */
export function planSetProps(
	store: DocumentStore,
	id: NodeId,
	props: Record<string, unknown>
): Change[] {
	const { set, prev } = changedProperties(store.requireNode(id), props);
	if (Object.keys(set).length === 0) return [];
	return [{ t: 'set', id, set, prev }];
}

/** Add one node; its `parentId` and `index` say where it goes. */
export function planInsert(node: Node): Change[] {
	return [{ t: 'add', node }];
}

/** Add nodes that already carry parent ids; parents must come before their children. */
export function planInsertAll(nodes: Node[]): Change[] {
	return nodes.map((node) => ({ t: 'add', node }));
}

/** Delete `id` and everything below it, deepest first so every `del` is of a leaf. */
export function planRemove(store: DocumentStore, id: NodeId): Change[] {
	const subtree = [store.requireNode(id), ...store.descendants(id)];
	return subtree.reverse().map((node) => ({ t: 'del', node }));
}

export function planMoveNode(
	store: DocumentStore,
	id: NodeId,
	parentId: NodeId | null,
	position: number
): Change[] {
	return [planMove(store, id, parentId, position)];
}

export function planEntityAdd<K extends EntityKind>(kind: K, entity: EntityMap[K]): Change[] {
	return [{ t: 'entity-add', kind, entity } as EntityChange];
}

export function planEntityDelete(store: DocumentStore, kind: EntityKind, id: string): Change[] {
	const entity = store.getEntity(kind, id);
	if (entity === undefined) throw new Error(`${kind} not found: ${id}`);
	return [{ t: 'entity-del', kind, entity } as EntityChange];
}

export function planEntitySet(
	store: DocumentStore,
	kind: EntityKind,
	id: string,
	props: Record<string, unknown>
): Change[] {
	const entity = store.getEntity(kind, id);
	if (entity === undefined) throw new Error(`${kind} not found: ${id}`);
	const { set, prev } = changedProperties(entity, props);
	if (Object.keys(set).length === 0) return [];
	return [{ t: 'entity-set', kind, id, set, prev } as EntityChange];
}
