// Absolute bounds from a SceneSource, for consumers that need a box now (viewport fit).
//
// `SceneBounds` is the cached form: the document layer's DerivedCache (absolute transforms and
// bounds, computed lazily and kept) over the source, invalidated incrementally by feeding it the
// source's change notifications (`handle`). The owner decides when to subscribe, so that mounting
// and unmounting stays observable-state neutral. Hit testing and culling use the SceneIndex in
// lib/document, which sits on the document store's own cache; this is the SceneSource-shaped
// entry for code that must not know about the store.
//
// `absoluteBoundsOf` and `pageContentBounds` are the cold one-shot variants (fresh cache).

import { DerivedCache } from '../document/cache';
import type { Change, NodeId, Rect } from '../document/types';
import { unionRects } from '../viewport/camera';
import type { SceneChange, SceneSource } from './sceneSource';

function invalidate(cache: DerivedCache, change: Change): void {
	switch (change.t) {
		case 'set':
			cache.onSet(change.id, Object.keys(change.set));
			return;
		case 'del':
			cache.invalidateSubtree(change.node.id);
			return;
		case 'move':
			cache.invalidateSubtree(change.id);
			return;
		default:
			return;
	}
}

export class SceneBounds {
	private readonly cache: DerivedCache;

	constructor(private readonly source: SceneSource) {
		this.cache = new DerivedCache(source);
	}

	/** Feed every notification of the source here to keep the cache valid. */
	handle(notification: SceneChange): void {
		if (notification.kind === 'reset') {
			this.cache.invalidateAll();
			return;
		}
		for (const change of notification.changes) invalidate(this.cache, change);
	}

	/** Axis-aligned bounds of node `id` in page space, or undefined when it does not exist. */
	absoluteBoundsOf(id: NodeId): Rect | undefined {
		const node = this.source.getNode(id);
		if (!node || node.type === 'PAGE') return undefined;
		return this.cache.absoluteBounds(id);
	}

	/** Bounds of everything visible directly on the current page; null for an empty page. */
	pageContentBounds(): Rect | null {
		const pageId = this.source.currentPageId();
		if (pageId === null) return null;
		const rects: Rect[] = [];
		for (const childId of this.source.children(pageId)) {
			const child = this.source.getNode(childId);
			if (!child || child.type === 'PAGE' || !child.visible) continue;
			const bounds = this.absoluteBoundsOf(childId);
			if (bounds) rects.push(bounds);
		}
		return unionRects(rects);
	}
}

/** Cold one-shot: bounds of node `id` computed from scratch. */
export function absoluteBoundsOf(source: SceneSource, id: NodeId): Rect | undefined {
	return new SceneBounds(source).absoluteBoundsOf(id);
}

/** Cold one-shot: bounds of everything visible on the current page. */
export function pageContentBounds(source: SceneSource): Rect | null {
	return new SceneBounds(source).pageContentBounds();
}
