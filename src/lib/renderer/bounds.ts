// Absolute bounds straight from a SceneSource, for consumers that need a box now (viewport fit).
// The spatial index (#40) caches the same numbers incrementally; this is the uncached definition.

import { composeMatrices, identityMatrix, transformedBounds } from '../document/matrix';
import type { Matrix2x3, NodeId, Rect } from '../document/types';
import { unionRects } from '../viewport/camera';
import type { SceneSource } from './sceneSource';

function absoluteTransform(source: SceneSource, id: NodeId): Matrix2x3 | undefined {
	const chain: Matrix2x3[] = [];
	let current = source.getNode(id);
	if (!current) return undefined;
	while (current && current.type !== 'PAGE') {
		chain.push(current.transform);
		if (current.parentId === null) break;
		current = source.getNode(current.parentId);
	}
	let result = identityMatrix();
	for (let position = chain.length - 1; position >= 0; position -= 1) {
		result = composeMatrices(result, chain[position]);
	}
	return result;
}

/** Axis-aligned bounds of node `id` in page space, or undefined when it does not exist. */
export function absoluteBoundsOf(source: SceneSource, id: NodeId): Rect | undefined {
	const node = source.getNode(id);
	if (!node || node.type === 'PAGE') return undefined;
	const transform = absoluteTransform(source, id);
	if (!transform) return undefined;
	return transformedBounds(transform, node.width, node.height);
}

/** Bounds of everything visible directly on the current page; null for an empty page. */
export function pageContentBounds(source: SceneSource): Rect | null {
	const pageId = source.currentPageId();
	if (pageId === null) return null;
	const rects: Rect[] = [];
	for (const childId of source.children(pageId)) {
		const child = source.getNode(childId);
		if (!child || child.type === 'PAGE' || !child.visible) continue;
		const bounds = absoluteBoundsOf(source, childId);
		if (bounds) rects.push(bounds);
	}
	return unionRects(rects);
}
