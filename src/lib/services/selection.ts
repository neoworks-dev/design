// The `selection` service: what is selected, the selection scope (the container whose children a
// single click selects), the hover target, and a per-page memory. Not part of the document and not
// in history; undo restores selection through `history`, which calls `restore`.
//
// `selection/change` fires once per actual change. The set is pruned when nodes disappear
// (document/change), cleared when the document is replaced, and swapped per page when the current
// page changes (document/currentpagechange).

import { Service, type Context } from '@neoworks/extension-system';
import {
	canHaveChildren,
	type DocumentChangeEvent,
	type Node,
	type NodeId,
	type NodeType
} from '../document';
import type { DocumentService } from './document';
import type { SelectionState } from './selectionState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		selection: SelectionService;
	}
}

export type SelectMode = 'replace' | 'add' | 'toggle' | 'remove';

export interface SelectOptions {
	/**
	 * Where the request comes from. The canvas never selects locked or hidden nodes; the layers
	 * panel and the API may.
	 */
	source?: 'canvas' | 'layers' | 'api';
}

export interface SelectionSummary {
	count: number;
	/** Distinct node types in the selection. */
	kinds: NodeType[];
	/** The type when all selected nodes share one, else `mixed`; `none` when empty. */
	kind: NodeType | 'mixed' | 'none';
	/** Parent shared by every selected node, or `null` when none or they differ. */
	commonParentId: NodeId | null;
}

export interface SelectionSnapshot {
	ids: readonly NodeId[];
	scopeId: NodeId | null;
}

function sameIds(left: readonly NodeId[], right: readonly NodeId[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((id, position) => id === right[position]);
}

export class SelectionService extends Service {
	/**
	 * `document` is captured at construction (from the providing plugin's ctx, which injects it):
	 * a service called through a consumer's ctx must not need that consumer to inject `document`.
	 */
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly state: SelectionState
	) {
		super(ctx, 'selection');
		this.state.scopeId = this.document.currentPageId;
	}

	// ---------- reads (reactive) ----------

	get ids(): readonly NodeId[] {
		return this.state.ids;
	}

	get count(): number {
		return this.state.ids.length;
	}

	/** The first selected node: the anchor for parent, sibling and the inspector. */
	get primaryId(): NodeId | null {
		const [first] = this.state.ids;
		if (first === undefined) return null;
		return first;
	}

	get scopeId(): NodeId | null {
		return this.state.scopeId;
	}

	get hoverId(): NodeId | null {
		return this.state.hoverId;
	}

	has(id: NodeId): boolean {
		return this.state.ids.includes(id);
	}

	nodes(): Node[] {
		const nodes: Node[] = [];
		for (const id of this.state.ids) {
			const node = this.document.get(id);
			if (node) nodes.push(node);
		}
		return nodes;
	}

	/** Count, kinds and common parent: what inspectors and menus need to decide what to show. */
	summary(): SelectionSummary {
		const nodes = this.nodes();
		const kinds = [...new Set(nodes.map((node) => node.type))];
		return {
			count: nodes.length,
			kinds,
			kind: summaryKind(kinds),
			commonParentId: commonParent(nodes)
		};
	}

	// ---------- changes ----------

	select(ids: readonly NodeId[], mode: SelectMode = 'replace', options: SelectOptions = {}): void {
		const requested = this.validated([...new Set(ids)], options);
		const next = combine(this.state.ids, requested, mode);
		this.commit(next, this.scopeFor(next));
	}

	clear(): void {
		this.commit([], this.document.currentPageId);
	}

	/** Select the parent of the primary node; a no-op when that parent is the page. */
	selectParent(): void {
		const primary = this.primaryId;
		if (primary === null) return;
		const parent = this.document.parentOf(primary);
		if (!parent || parent.type === 'PAGE') return;
		this.select([parent.id], 'replace');
	}

	/** Select the children of the selected containers; a no-op when none has children. */
	selectChildren(): void {
		const children = this.state.ids.flatMap((id) => [...this.document.children(id)]);
		if (children.length === 0) return;
		this.select(children, 'replace');
	}

	/** Select the next or previous sibling of the primary node, wrapping around. */
	selectSibling(direction: 'next' | 'previous'): void {
		const primary = this.primaryId;
		if (primary === null) return;
		const node = this.document.require(primary);
		const siblings = this.document.children(node.parentId);
		if (siblings.length < 2) return;
		const position = siblings.indexOf(primary);
		const step = direction === 'next' ? 1 : -1;
		const target = siblings[(position + step + siblings.length) % siblings.length];
		this.select([target], 'replace');
	}

	setScope(containerId: NodeId): void {
		const container = this.document.get(containerId);
		if (!container) throw new Error(`node not found: ${containerId}`);
		if (!canHaveChildren(container.type)) throw new Error(`${container.type} is not a container`);
		this.state.scopeId = containerId;
	}

	setHover(id: NodeId | null): void {
		if (id !== null && !this.document.has(id)) {
			this.state.hoverId = null;
			return;
		}
		this.state.hoverId = id;
	}

	// ---------- history support ----------

	snapshot(): SelectionSnapshot {
		return { ids: this.state.ids, scopeId: this.state.scopeId };
	}

	/** Put back a selection taken with `snapshot()`, dropping nodes that no longer exist. */
	restore(snapshot: SelectionSnapshot): void {
		const alive = snapshot.ids.filter((id) => this.isOnCurrentPage(id));
		let scope = snapshot.scopeId;
		if (scope === null || !this.document.has(scope)) scope = this.document.currentPageId;
		this.commit(alive, scope);
	}

	// ---------- reactions to the document (wired by the plugin) ----------

	/** Drop selected nodes that were deleted or left the current page. */
	handleDocumentChange(_event: DocumentChangeEvent): void {
		const alive = this.state.ids.filter((id) => this.isOnCurrentPage(id));
		let scope = this.state.scopeId;
		if (scope === null || !this.document.has(scope)) scope = this.document.currentPageId;
		if (this.state.hoverId !== null && !this.document.has(this.state.hoverId)) {
			this.state.hoverId = null;
		}
		for (const pageId of this.state.memory.keys()) {
			if (!this.document.has(pageId)) this.state.memory.delete(pageId);
		}
		this.commit(alive, scope);
	}

	/** Remember the selection of the page being left and restore the one of the page entered. */
	handleCurrentPageChange(pageId: NodeId, previousPageId: NodeId | null): void {
		this.state.hoverId = null;
		if (previousPageId !== null) {
			this.state.memory.set(previousPageId, { ids: this.state.ids, scopeId: this.state.scopeId });
		}
		const remembered = this.state.memory.get(pageId);
		if (!remembered) {
			this.commit([], pageId);
			return;
		}
		const alive = remembered.ids.filter((id) => this.isOnCurrentPage(id));
		let scope = remembered.scopeId;
		if (scope === null || !this.document.has(scope)) scope = pageId;
		this.commit(alive, scope);
	}

	/** A different document was loaded: nothing of the old selection applies. */
	handleDocumentReplace(): void {
		this.state.memory.clear();
		this.state.hoverId = null;
		this.commit([], this.document.currentPageId);
	}

	snapshotState(): Record<string, unknown> {
		return { ids: [...this.state.ids], scopeId: this.state.scopeId };
	}

	// ---------- internals ----------

	private commit(ids: readonly NodeId[], scopeId: NodeId | null): void {
		this.state.scopeId = scopeId;
		if (sameIds(this.state.ids, ids)) return;
		const previous = this.state.ids;
		this.state.ids = ids;
		this.ctx.emit('selection/change', ids, previous);
	}

	private scopeFor(ids: readonly NodeId[]): NodeId | null {
		const [first] = ids;
		if (first === undefined) return this.state.scopeId;
		const node = this.document.require(first);
		if (node.parentId === null) return this.state.scopeId;
		return node.parentId;
	}

	private isOnCurrentPage(id: NodeId): boolean {
		const node = this.document.get(id);
		if (!node || node.type === 'PAGE') return false;
		return this.document.pageOf(id).id === this.document.currentPageId;
	}

	private validated(ids: NodeId[], options: SelectOptions): NodeId[] {
		for (const id of ids) {
			const node = this.document.get(id);
			if (!node) throw new Error(`cannot select unknown node ${id}`);
			if (node.type === 'PAGE') throw new Error(`cannot select page ${id}`);
			if (!this.isOnCurrentPage(id)) throw new Error(`${id} is not on the current page`);
		}
		if (options.source !== 'canvas') return ids;
		return ids.filter((id) => this.isSelectableFromCanvas(id));
	}

	/** Locked or hidden nodes, or nodes below one, cannot be picked on the canvas. */
	private isSelectableFromCanvas(id: NodeId): boolean {
		const chain = [this.document.require(id), ...this.document.ancestors(id)];
		return chain.every((node) => node.type === 'PAGE' || (node.visible && !node.locked));
	}
}

function combine(
	current: readonly NodeId[],
	requested: readonly NodeId[],
	mode: SelectMode
): NodeId[] {
	switch (mode) {
		case 'replace':
			return [...requested];
		case 'add':
			return [...current, ...requested.filter((id) => !current.includes(id))];
		case 'remove':
			return current.filter((id) => !requested.includes(id));
		case 'toggle': {
			const kept = current.filter((id) => !requested.includes(id));
			return [...kept, ...requested.filter((id) => !current.includes(id))];
		}
	}
}

function summaryKind(kinds: NodeType[]): SelectionSummary['kind'] {
	if (kinds.length === 0) return 'none';
	if (kinds.length === 1) return kinds[0];
	return 'mixed';
}

function commonParent(nodes: Node[]): NodeId | null {
	if (nodes.length === 0) return null;
	const first = nodes[0].parentId;
	if (nodes.every((node) => node.parentId === first)) return first;
	return null;
}
