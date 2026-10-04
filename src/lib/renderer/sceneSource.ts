// What the renderer reads: a SceneSource. It is deliberately small and knows nothing about the
// document *service*, so the renderer works today on a hand-built fixture and later on the real
// document without changes.
//
// THE SEAM. The `document-scene` plugin implements SceneSource over `ctx.document` (current page,
// nodes resolved through `ctx.variables`) and hands it to the renderer with
// `ctx.renderer.setSceneSource(source)`: `document/change` becomes `{ kind: 'changes' }`; page
// switches and `document/replace` become `{ kind: 'reset' }`. `StoreSceneSource` (a plain
// DocumentStore) remains for tests and headless drawing.

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
