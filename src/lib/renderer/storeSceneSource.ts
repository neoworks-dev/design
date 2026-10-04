// SceneSource over a plain DocumentStore. Used by the dev/QA `scene-fixture` plugin and by tests;
// the real document service gets its own adapter (see sceneSource.ts).

import { DocumentStore } from '../document/store';
import type { Change, DesignDocument, Node, NodeId } from '../document/types';
import type { SceneListener, SceneSource } from './sceneSource';

export type NodeResolver = <T extends Node>(node: T) => T;

export interface StoreSceneOptions {
	/** Variable resolution; identity by default. */
	resolve?: NodeResolver;
	/** Page to show; defaults to the first page. */
	pageId?: NodeId;
}

export class StoreSceneSource implements SceneSource {
	readonly store: DocumentStore;
	private pageId: NodeId | null;
	private readonly listeners = new Set<SceneListener>();
	private readonly resolver: NodeResolver | undefined;

	constructor(document: DesignDocument, options: StoreSceneOptions = {}) {
		this.store = new DocumentStore(document);
		this.resolver = options.resolve;
		this.pageId = firstPageId(this.store, options.pageId);
	}

	currentPageId(): NodeId | null {
		return this.pageId;
	}

	getNode(id: NodeId): Node | undefined {
		return this.store.getNode(id);
	}

	children(id: NodeId | null): readonly NodeId[] {
		return this.store.children(id);
	}

	resolve<T extends Node>(node: T): T {
		if (!this.resolver) return node;
		return this.resolver(node);
	}

	subscribe(listener: SceneListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Applies changes to the store, then tells subscribers. */
	apply(changes: Change[]): void {
		this.store.applyAll(changes);
		for (const listener of this.listeners) listener({ kind: 'changes', changes });
	}

	showPage(pageId: NodeId): void {
		this.store.requireNode(pageId);
		this.pageId = pageId;
		this.notifyReset();
	}

	/** For when `resolve` would now return different values (a variable changed). */
	notifyReset(): void {
		for (const listener of this.listeners) listener({ kind: 'reset' });
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

function firstPageId(store: DocumentStore, requested: NodeId | undefined): NodeId | null {
	if (requested !== undefined) return requested;
	const pages = store.children(null);
	if (pages.length === 0) return null;
	return pages[0];
}
