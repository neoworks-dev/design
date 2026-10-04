// The `document` service: the live document and the ONE mutation path, `apply`.
//
//   const transaction = ctx.document.apply(ctx.document.setProps(id, { name: 'Hero' }), {
//   	origin: 'user',
//   	label: 'Rename'
//   });
//
// What `apply` does (CLAUDE.md "Document model", data-model.md section 5):
//   1. `document/before-apply` (waterfall): plugins veto by throwing, or rewrite the changes.
//   2. Validate and apply atomically (lib/document/apply.ts): structure, schemas, component
//      cycles. Any failure rolls the whole call back and throws; the document is untouched.
//   3. `document/append` (waterfall): reflow and component sync append derived changes, which
//      land in the same transaction (one undo step), reported with origin `sync`.
//   4. Compute `undo` (exact inverse), bump the revision, emit `document/change`.
//
// `transaction(meta, fn)` batches several `apply` calls into one committed Transaction.
// Reads (`get`, `children`, ...) are reactive: they depend on the revision.

import { Service, type Context } from '@neoworks/extension-system';
import {
	affectedNodeIds,
	applyChanges,
	generateNodeId,
	invertChanges,
	planEntityAdd,
	planEntityDelete,
	planEntitySet,
	planInsert,
	planInsertAll,
	planMoveNode,
	planRemove,
	planSetProps,
	rollback,
	toDocumentChanges,
	type ApplyMeta,
	type Change,
	type DesignDocument,
	type DocumentReader,
	type EntityKind,
	type EntityMap,
	type Matrix2x3,
	type Node,
	type NodeId,
	type PageNode,
	type Rect,
	type Transaction
} from '../document';
import type { Batch, DocumentState } from './documentState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		document: DocumentService;
	}
}

/** Derived changes can trigger more derived changes; a loop of this depth is a bug in a listener. */
const MAX_APPEND_ROUNDS = 8;

export class DocumentService extends Service {
	constructor(
		ctx: Context,
		private readonly state: DocumentState
	) {
		super(ctx, 'document');
		this.ensureCurrentPage();
	}

	// ---------- reads (reactive) ----------

	/** Read-only view of the store for derived layers. Never mutate through it. */
	get reader(): DocumentReader {
		this.state.track();
		return this.state.store;
	}

	get snapshot(): DesignDocument {
		this.state.track();
		return this.state.store.document;
	}

	/** Increases on every commit and on `replaceDocument`. Dirty state is a revision compare. */
	get revision(): number {
		return this.state.revision;
	}

	get documentId(): string {
		return this.snapshot.id;
	}

	get documentName(): string {
		return this.snapshot.name;
	}

	get(id: NodeId): Node | undefined {
		this.state.track();
		return this.state.store.getNode(id);
	}

	require(id: NodeId): Node {
		this.state.track();
		return this.state.store.requireNode(id);
	}

	has(id: NodeId): boolean {
		this.state.track();
		return this.state.store.hasNode(id);
	}

	/** Child ids in sibling order; `null` lists the pages. */
	children(id: NodeId | null): readonly NodeId[] {
		this.state.track();
		return this.state.store.children(id);
	}

	childNodes(id: NodeId | null): Node[] {
		this.state.track();
		return this.state.store.childNodes(id);
	}

	parentOf(id: NodeId): Node | undefined {
		this.state.track();
		return this.state.store.parentOf(id);
	}

	ancestors(id: NodeId): Node[] {
		this.state.track();
		return this.state.store.ancestors(id);
	}

	descendants(id: NodeId): Node[] {
		this.state.track();
		return this.state.store.descendants(id);
	}

	pageOf(id: NodeId): Node {
		this.state.track();
		return this.state.store.pageOf(id);
	}

	/** Nodes below `rootId` (the whole document when omitted) that satisfy `predicate`. */
	query(predicate: (node: Node) => boolean, rootId?: NodeId): Node[] {
		this.state.track();
		const store = this.state.store;
		const candidates =
			rootId === undefined ? Object.values(store.nodes) : store.descendants(rootId);
		return candidates.filter(predicate);
	}

	absoluteTransform(id: NodeId): Matrix2x3 {
		this.state.track();
		return this.state.store.cache.absoluteTransform(id);
	}

	absoluteBounds(id: NodeId): Rect {
		this.state.track();
		return this.state.store.cache.absoluteBounds(id);
	}

	getEntity<K extends EntityKind>(kind: K, id: string): EntityMap[K] | undefined {
		this.state.track();
		return this.state.store.getEntity(kind, id);
	}

	entities<K extends EntityKind>(kind: K): EntityMap[K][] {
		this.state.track();
		return this.state.store.entities(kind);
	}

	// ---------- change builders (pure: they read, never apply) ----------

	/** A `set` for the top-level keys of `props` that differ from the stored values. */
	setProps(id: NodeId, props: Record<string, unknown>): Change[] {
		return planSetProps(this.state.store, id, props);
	}

	insertNode(node: Node): Change[] {
		return planInsert(node);
	}

	/** `nodes` must list parents before children. */
	insertNodes(nodes: Node[]): Change[] {
		return planInsertAll(nodes);
	}

	moveNode(id: NodeId, parentId: NodeId | null, position: number): Change[] {
		return planMoveNode(this.state.store, id, parentId, position);
	}

	/** Delete the node and its whole subtree. */
	removeNode(id: NodeId): Change[] {
		return planRemove(this.state.store, id);
	}

	addEntity<K extends EntityKind>(kind: K, entity: EntityMap[K]): Change[] {
		return planEntityAdd(kind, entity);
	}

	setEntityProps(kind: EntityKind, id: string, props: Record<string, unknown>): Change[] {
		return planEntitySet(this.state.store, kind, id, props);
	}

	removeEntity(kind: EntityKind, id: string): Change[] {
		return planEntityDelete(this.state.store, kind, id);
	}

	// ---------- the mutation path ----------

	/**
	 * Apply `changes` as one transaction (or as part of the open `transaction()` batch). Throws,
	 * leaving the document untouched, when any change is invalid.
	 *
	 * Inside a `transaction()` the returned object describes only this call's changes; the
	 * committed Transaction (emitted in `document/change`) carries the batch's id.
	 */
	apply(changes: Change[], meta: ApplyMeta): Transaction {
		const open = this.state.batch;
		if (open) return this.applyIntoBatch(open, changes, meta);
		const batch = this.openBatch(meta);
		try {
			this.applyIntoBatch(batch, changes, meta);
		} catch (error) {
			this.abortBatch(batch);
			throw error;
		}
		return this.commitBatch(batch);
	}

	/**
	 * Run `run` synchronously and commit everything it applied as ONE Transaction. If it throws,
	 * everything it applied is rolled back. A nested call joins the outer batch. For async runs
	 * (a plugin, an AI run) group at the history level instead: `history.group`.
	 */
	transaction<T>(meta: ApplyMeta, run: () => T): T {
		if (this.state.batch) return run();
		const batch = this.openBatch(meta);
		let result: T;
		try {
			result = run();
			if (isThenable(result)) {
				throw new TypeError(
					'document.transaction() is synchronous; use history.group for async runs'
				);
			}
		} catch (error) {
			this.abortBatch(batch);
			throw error;
		}
		this.commitBatch(batch);
		return result;
	}

	/**
	 * Replace the whole document (new, open). Not a transaction: history and selection reset
	 * through `document/replace`.
	 */
	replaceDocument(document: DesignDocument): void {
		if (this.state.batch) throw new Error('cannot replace the document inside a transaction');
		const previousPage = this.state.currentPageId;
		this.state.replace(document);
		this.state.currentPageId = null;
		this.ensureCurrentPage();
		this.ctx.emit('document/replace', {
			revision: this.state.revision,
			documentId: document.id
		});
		this.emitPageChangeIfNeeded(previousPage);
	}

	// ---------- current page ----------

	get currentPageId(): NodeId {
		this.state.track();
		const id = this.state.currentPageId;
		if (id === null) throw new Error('document has no current page');
		return id;
	}

	get currentPage(): PageNode {
		const page = this.require(this.currentPageId);
		if (page.type !== 'PAGE') throw new Error(`current page ${page.id} is not a page`);
		return page;
	}

	pages(): PageNode[] {
		this.state.track();
		return this.state.store.pages().filter((node): node is PageNode => node.type === 'PAGE');
	}

	/** Switch the current page. Not undoable and not in the document: it is view state. */
	setCurrentPage(pageId: NodeId): void {
		const page = this.state.store.getNode(pageId);
		if (!page || page.type !== 'PAGE') throw new Error(`not a page: ${pageId}`);
		const previous = this.state.currentPageId;
		if (previous === pageId) return;
		this.state.currentPageId = pageId;
		this.ctx.emit('document/currentpagechange', pageId, previous);
	}

	snapshotState(): Record<string, unknown> {
		return { revision: this.state.revision, nodeCount: Object.keys(this.state.store.nodes).length };
	}

	// ---------- internals ----------

	private openBatch(meta: ApplyMeta): Batch {
		const batch: Batch = { id: generateNodeId(), meta, applied: [], derived: [] };
		this.state.batch = batch;
		try {
			this.ctx.emit('document/begin', meta);
		} catch (error) {
			this.ctx.logger.error(error);
		}
		return batch;
	}

	private applyIntoBatch(batch: Batch, changes: Change[], meta: ApplyMeta): Transaction {
		const start = batch.applied.length;
		try {
			const rewritten = this.ctx.waterfall('document/before-apply', changes, meta, () => changes);
			const own = applyChanges(this.state.store, rewritten);
			this.record(batch, own, false);
			this.appendDerived(batch, own, meta);
		} catch (error) {
			this.discardSince(batch, start);
			throw error;
		}
		const mine = batch.applied.slice(start);
		return {
			id: batch.id,
			origin: meta.origin,
			label: meta.label,
			changes: mine,
			undo: invertChanges(mine),
			mergeKey: meta.mergeKey
		};
	}

	private appendDerived(batch: Batch, applied: Change[], meta: ApplyMeta): void {
		let pending = applied;
		for (let round = 0; pending.length > 0; round += 1) {
			if (round >= MAX_APPEND_ROUNDS) {
				throw new Error(`document/append did not settle after ${MAX_APPEND_ROUNDS} rounds`);
			}
			const extra = this.ctx.waterfall('document/append', { changes: pending, meta }, () => []);
			if (extra.length === 0) return;
			pending = applyChanges(this.state.store, extra);
			this.record(batch, pending, true);
		}
	}

	private record(batch: Batch, applied: Change[], derived: boolean): void {
		for (const change of applied) {
			batch.applied.push(change);
			batch.derived.push(derived);
		}
	}

	private discardSince(batch: Batch, start: number): void {
		rollback(this.state.store, batch.applied.slice(start));
		batch.applied.length = start;
		batch.derived.length = start;
	}

	private abortBatch(batch: Batch): void {
		this.discardSince(batch, 0);
		this.state.batch = null;
	}

	private commitBatch(batch: Batch): Transaction {
		this.state.batch = null;
		const { meta, applied } = batch;
		const transaction: Transaction = {
			id: batch.id,
			origin: meta.origin,
			label: meta.label,
			changes: applied,
			undo: invertChanges(applied),
			mergeKey: meta.mergeKey
		};
		if (applied.length === 0) return transaction;

		this.state.revision += 1;
		const previousPage = this.state.currentPageId;
		this.ensureCurrentPage();
		this.emitChange(batch, transaction);
		this.emitPageChangeIfNeeded(previousPage);
		return transaction;
	}

	private emitChange(batch: Batch, transaction: Transaction): void {
		try {
			this.ctx.emit('document/change', {
				transaction,
				meta: batch.meta,
				revision: this.state.revision,
				changes: toDocumentChanges(transaction.changes, batch.derived, transaction.origin),
				affectedNodeIds: affectedNodeIds(transaction.changes)
			});
		} catch (error) {
			this.ctx.logger.error(error);
		}
	}

	/** The current page vanished (deleted, undo of create) or never was set: pick the first. */
	private ensureCurrentPage(): void {
		const current = this.state.currentPageId;
		if (current !== null && this.state.store.hasNode(current)) return;
		const first = this.state.store.pages()[0];
		this.state.currentPageId = first ? first.id : null;
	}

	private emitPageChangeIfNeeded(previous: NodeId | null): void {
		const current = this.state.currentPageId;
		if (current === null || current === previous) return;
		this.ctx.emit('document/currentpagechange', current, previous);
	}
}

function isThenable(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	return typeof Reflect.get(value, 'then') === 'function';
}
