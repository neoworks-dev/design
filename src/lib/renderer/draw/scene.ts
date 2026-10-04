// Walks the current page and draws it. Per node, in this order (issue #34):
//   1. parent transform, node opacity, blend mode and layer blur (one layer when composited)
//   2. effects behind (hook), fills bottom to top, effects inside (hook), strokes
//   3. text (hook)
//   4. children, clipped to the node when it clips content
// A mask node (masks.ts) masks the siblings above it. Every value comes from `source.resolve(node)`: variables are already applied.

import type { NodeId, SceneNode } from '../../document/types';
import type { FrameResult } from '../types';
import type { DrawContext } from './context';
import { drawMasked, isMaskNode } from './masks';
import { drawFromPicture } from './pictures';
import { toCanvasKitMatrix } from './matrix';
import { drawFills, isIsolatingBlendMode, skiaBlendMode } from './paints';
import { buildNodeShape, type NodeShape } from './shape';
import { drawStrokes } from './strokes';

export function drawScene(context: DrawContext): FrameResult {
	const pageId = context.source.currentPageId();
	if (pageId !== null) drawChildren(context, pageId);
	return {
		drawn: true,
		drawnNodes: context.counters.drawnNodes,
		layers: context.counters.layers,
		picturesReplayed: context.counters.picturesReplayed,
		picturesRecorded: context.counters.picturesRecorded
	};
}

/** Draws one node and its subtree where the canvas currently is (export). */
export function drawNodeSubtree(context: DrawContext, id: NodeId): void {
	drawNode(context, id);
}

/** Draws every node of a page, whatever the source's current page is (export). */
export function drawPageContents(context: DrawContext, pageId: NodeId): void {
	drawChildren(context, pageId);
}

function drawChildren(context: DrawContext, parentId: NodeId): void {
	drawSiblings(context, context.source.children(parentId));
}

/** Draws siblings bottom to top; a visible mask node masks everything after it. */
function drawSiblings(context: DrawContext, ids: readonly NodeId[]): void {
	for (let index = 0; index < ids.length; index += 1) {
		const mask = maskAt(context, ids[index]);
		if (mask === null) {
			drawNode(context, ids[index]);
			continue;
		}
		const masked = ids.slice(index + 1);
		drawMasked(context, mask, masked, (rest) => drawSiblings(context, rest), drawNode);
		return;
	}
}

function maskAt(context: DrawContext, id: NodeId): SceneNode | null {
	const stored = context.source.getNode(id);
	if (!stored || stored.type === 'PAGE') return null;
	const node = context.source.resolve(stored);
	if (node.type === 'SLICE' || !node.visible) return null;
	if (!isMaskNode(node)) return null;
	return node;
}

function drawNode(context: DrawContext, id: NodeId): void {
	if (context.needed !== null && !context.needed.has(id)) return;
	if (drawFromPicture(context, id, drawNodeDirect)) return;
	drawNodeDirect(context, id);
}

function drawNodeDirect(context: DrawContext, id: NodeId): void {
	const stored = context.source.getNode(id);
	if (!stored || stored.type === 'PAGE') return;
	const node = context.source.resolve(stored);
	if (node.type === 'SLICE' || !node.visible) return;
	const { canvas } = context;
	canvas.save();
	canvas.concat(toCanvasKitMatrix(node.transform));
	const layered = beginLayer(context, node);
	const shape = buildNodeShape(context, node);
	if (shape) drawOwnContent(context, node, shape);
	if (node.type === 'TEXT') context.hooks.drawText(context, node);
	drawNodeChildren(context, node, shape);
	if (layered) canvas.restore();
	canvas.restore();
}

/** Opacity and non-normal blend modes apply to the node and its subtree as a unit. */
function beginLayer(context: DrawContext, node: SceneNode): boolean {
	if (!('opacity' in node)) return false;
	const needsOpacity = node.opacity < 1;
	const filter = context.hooks.layerImageFilter(context, node);
	if (!needsOpacity && !isIsolatingBlendMode(node.blendMode) && filter === null) return false;
	const { canvasKit, canvas, scope } = context;
	const layerPaint = scope.own(new canvasKit.Paint());
	layerPaint.setAlphaf(node.opacity);
	layerPaint.setBlendMode(skiaBlendMode(context, node.blendMode));
	if (filter !== null) layerPaint.setImageFilter(filter);
	canvas.saveLayer(layerPaint);
	context.counters.layers += 1;
	return true;
}

function drawOwnContent(context: DrawContext, node: SceneNode, shape: NodeShape): void {
	if (!('fills' in node)) return;
	context.hooks.drawEffectsBehind(context, node, shape);
	let drawn = 0;
	if (shape.fillPath) drawn += drawFills(context, node.fills, shape.fillPath, shape.size);
	context.hooks.drawEffectsInside(context, node, shape);
	drawn += drawStrokes(context, node.strokes, shape);
	if (drawn > 0) context.counters.drawnNodes += 1;
}

function drawNodeChildren(context: DrawContext, node: SceneNode, shape: NodeShape | null): void {
	if (node.type === 'SECTION' && node.sectionContentsHidden) return;
	const { canvas, canvasKit } = context;
	const clips = clipsChildren(node) && shape !== null && shape.fillPath !== null;
	if (clips && shape && shape.fillPath) {
		canvas.save();
		canvas.clipPath(shape.fillPath, canvasKit.ClipOp.Intersect, true);
	}
	drawChildren(context, node.id);
	if (clips) canvas.restore();
}

function clipsChildren(node: SceneNode): boolean {
	switch (node.type) {
		case 'FRAME':
		case 'COMPONENT':
		case 'COMPONENT_SET':
		case 'INSTANCE':
			return node.clipsContent;
		default:
			return false;
	}
}
