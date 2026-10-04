// What the renderer reads: a SceneSource. It is deliberately small and knows nothing about the
// document *service*, so the renderer works today on a hand-built fixture and later on the real
// document without changes.
//
// THE SEAM. Once the document service (`ctx.document`: `apply()`, `document/change` events, pages,
// variable resolver) exists, one small adapter plugin implements SceneSource over it and hands it
// to the renderer with `ctx.renderer.setSceneSource(source)`:
//
//   currentPageId()  <- ctx.document.currentPageId
//   getNode / children <- ctx.document's DocumentStore (`store.getNode`, `store.children`)
//   resolve(node)    <- the variable resolver (D6); identity until it exists
//   subscribe(fn)    <- ctx.on('document/change', (transaction) =>
//                         fn({ kind: 'changes', changes: transaction.changes })), and
//                       `{ kind: 'reset' }` for page switches, file open and variable-mode changes.
//
// `scene-fixture` (dev/QA only) is the only other implementation: `StoreSceneSource` over a
// DocumentStore built by `buildDocument`.

import type { Change, Node, NodeId } from '../document/types';

export type SceneChange =
	/** Changes were applied to the document; the node map already reflects them. */
	| { kind: 'changes'; changes: readonly Change[] }
	/** Anything may have changed (page switch, document replaced, variable mode changed). */
	| { kind: 'reset' };

export type SceneListener = (change: SceneChange) => void;

export interface SceneSource {
	/** The page being shown, or null when there is none. Pages are the roots of the node map. */
	currentPageId(): NodeId | null;
	getNode(id: NodeId): Node | undefined;
	/** Child ids in paint order (first is bottom-most); `null` lists the pages. */
	children(id: NodeId | null): readonly NodeId[];
	/**
	 * Variable-resolved copy of `node`: the renderer draws what this returns and never the raw
	 * stored properties (docs/design/data-model.md section 4). Identity when nothing is bound.
	 */
	resolve<T extends Node>(node: T): T;
	/** Called after every change to the nodes or to what `resolve` returns. Returns a disposer. */
	subscribe(listener: SceneListener): () => void;
}
