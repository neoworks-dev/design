// The in-memory document core: the flat node map plus the derived child index and caches, kept
// consistent while changes are applied. Pure and synchronous, so it runs in a worker. The kernel's
// `document` service wraps one of these; it adds events, history and validation policy on top.
//
// Node objects are never mutated: a `set` replaces the node with an updated copy, so snapshots
// held by `del` changes, history and the renderer stay valid.

import { ChildIndex, type NodeMap } from './childIndex';
import { DerivedCache } from './cache';
import type { Change, DesignDocument, EntityChange, EntityKind, Node, NodeId } from './types';
import { ENTITY_KINDS } from './types';

const PROTECTED_KEYS = ['id', 'type', 'parentId', 'index'];

type EntityTable = Record<string, unknown>;

export function invertChange(change: Change): Change {
	switch (change.t) {
		case 'add':
			return { t: 'del', node: change.node };
		case 'del':
			return { t: 'add', node: change.node };
		case 'set':
			return { t: 'set', id: change.id, set: change.prev, prev: change.set };
		case 'move':
			return {
				t: 'move',
				id: change.id,
				parent: change.prevParent,
				index: change.prevIndex,
				prevParent: change.parent,
				prevIndex: change.index
			};
		case 'entity-add':
			return { ...change, t: 'entity-del' };
		case 'entity-del':
			return { ...change, t: 'entity-add' };
		case 'entity-set':
			return { ...change, set: change.prev, prev: change.set };
	}
}

/** Inverse of a change list: every change inverted, in reverse order. */
export function invertChanges(changes: Change[]): Change[] {
	return changes.map(invertChange).reverse();
}

export class DocumentStore {
	readonly document: DesignDocument;
	readonly cache: DerivedCache;
	private readonly childIndex: ChildIndex;

	constructor(document: DesignDocument) {
		this.document = document;
		this.childIndex = new ChildIndex(document.nodes);
		this.cache = new DerivedCache(this);
	}

	// ---------- queries ----------

	get nodes(): NodeMap {
		return this.document.nodes;
	}

	hasNode(id: NodeId): boolean {
		return Object.hasOwn(this.document.nodes, id);
	}

	getNode(id: NodeId): Node | undefined {
		if (!this.hasNode(id)) return undefined;
		return this.document.nodes[id];
	}

	requireNode(id: NodeId): Node {
		const node = this.getNode(id);
		if (!node) throw new Error(`node not found: ${id}`);
		return node;
	}

	/** Child ids of `parentId` in sibling order; `null` lists the pages. */
	children(parentId: NodeId | null): readonly NodeId[] {
		return this.childIndex.children(parentId);
	}

	childNodes(parentId: NodeId | null): Node[] {
		return this.children(parentId).map((id) => this.requireNode(id));
	}

	pages(): Node[] {
		return this.childNodes(null);
	}

	parentOf(id: NodeId): Node | undefined {
		const parentId = this.requireNode(id).parentId;
		if (parentId === null) return undefined;
		return this.getNode(parentId);
	}

	/** Nearest parent first, ending at the page. */
	ancestors(id: NodeId): Node[] {
		const chain: Node[] = [];
		let parent = this.parentOf(id);
		while (parent) {
			chain.push(parent);
			parent = this.parentOf(parent.id);
		}
		return chain;
	}

	/** Every node below `id`, parents before children, siblings in order. */
	descendants(id: NodeId): Node[] {
		const result: Node[] = [];
		const pending = [...this.children(id)].reverse();
		while (pending.length > 0) {
			const current = pending.pop();
			if (current === undefined) break;
			result.push(this.requireNode(current));
			pending.push(...[...this.children(current)].reverse());
		}
		return result;
	}

	isDescendantOf(id: NodeId, ancestorId: NodeId): boolean {
		let parentId = this.requireNode(id).parentId;
		while (parentId !== null) {
			if (parentId === ancestorId) return true;
			parentId = this.requireNode(parentId).parentId;
		}
		return false;
	}

	pageOf(id: NodeId): Node {
		let current = this.requireNode(id);
		while (current.parentId !== null) current = this.requireNode(current.parentId);
		return current;
	}

	// ---------- mutation ----------

	/** Applies the changes in order; if one throws, the ones already applied are undone. */
	applyAll(changes: Change[]): void {
		const applied: Change[] = [];
		try {
			for (const change of changes) {
				this.apply(change);
				applied.push(change);
			}
		} catch (error) {
			for (const change of applied.reverse()) this.apply(invertChange(change));
			throw error;
		}
	}

	apply(change: Change): void {
		switch (change.t) {
			case 'add':
				return this.addNode(change.node);
			case 'del':
				return this.deleteNode(change.node.id);
			case 'set':
				return this.setNode(change.id, change.set);
			case 'move':
				return this.moveNode(change.id, change.parent, change.index);
			case 'entity-add':
			case 'entity-del':
			case 'entity-set':
				return this.applyEntityChange(change);
		}
	}

	private addNode(node: Node): void {
		if (this.hasNode(node.id)) throw new Error(`node already exists: ${node.id}`);
		this.document.nodes[node.id] = node;
		this.childIndex.insert(node);
	}

	private deleteNode(id: NodeId): void {
		const node = this.requireNode(id);
		if (this.childIndex.childCount(id) > 0) {
			throw new Error(`cannot delete ${id}: it still has children, delete them first`);
		}
		this.cache.invalidateSubtree(id);
		this.childIndex.remove(id, node.parentId, node.index);
		delete this.document.nodes[id];
	}

	private setNode(id: NodeId, set: Record<string, unknown>): void {
		const node = this.requireNode(id);
		const keys = Object.keys(set);
		const protectedKey = keys.find((key) => PROTECTED_KEYS.includes(key));
		if (protectedKey) {
			throw new Error(`cannot set "${protectedKey}" on ${id}; use a move change for position`);
		}
		this.cache.onSet(id, keys);
		this.document.nodes[id] = withProperties(node, set);
	}

	private moveNode(id: NodeId, parentId: NodeId | null, index: string): void {
		const node = this.requireNode(id);
		if (parentId !== null) this.assertParentAccepts(id, parentId);
		this.cache.invalidateSubtree(id);
		this.childIndex.remove(id, node.parentId, node.index);
		const moved = { ...node, parentId, index } as Node;
		this.document.nodes[id] = moved;
		this.childIndex.insert(moved);
	}

	private assertParentAccepts(id: NodeId, parentId: NodeId): void {
		this.requireNode(parentId);
		if (parentId === id || this.isDescendantOf(parentId, id)) {
			throw new Error(`cannot move ${id} into its own subtree (${parentId})`);
		}
	}

	private applyEntityChange(change: EntityChange): void {
		const table = this.entityTable(change.kind);
		if (change.t === 'entity-add') {
			if (Object.hasOwn(table, change.entity.id)) {
				throw new Error(`${change.kind} already exists: ${change.entity.id}`);
			}
			table[change.entity.id] = change.entity;
			return;
		}
		if (change.t === 'entity-del') {
			if (!Object.hasOwn(table, change.entity.id)) {
				throw new Error(`${change.kind} not found: ${change.entity.id}`);
			}
			delete table[change.entity.id];
			return;
		}
		if (!Object.hasOwn(table, change.id)) throw new Error(`${change.kind} not found: ${change.id}`);
		const existing = table[change.id];
		if (typeof existing !== 'object' || existing === null) return;
		table[change.id] = withProperties(existing, change.set);
	}

	private entityTable(kind: EntityKind): EntityTable {
		if (!ENTITY_KINDS.includes(kind)) throw new Error(`unknown entity kind: ${kind}`);
		switch (kind) {
			case 'style':
				return this.document.styles;
			case 'variable':
				return this.document.variables;
			case 'collection':
				return this.document.variableCollections;
			case 'asset':
				return this.document.assets;
		}
	}
}

/** Copy of `target` with `set` applied; an `undefined` value removes the property. */
function withProperties<T extends object>(target: T, set: Record<string, unknown>): T {
	const copy = { ...target } as Record<string, unknown>;
	for (const [key, value] of Object.entries(set)) {
		if (value === undefined) {
			delete copy[key];
			continue;
		}
		copy[key] = value;
	}
	return copy as T;
}
