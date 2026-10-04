// Walks the current page and draws it. Per node, in this order (issue #34):
//   1. parent transform, node opacity and blend mode (one layer when the node is composited)
//   2. effects behind (hook), fills bottom to top, effects inside (hook), strokes
//   3. text (hook)
//   4. children, clipped to the node when it clips content
// Every value comes from `source.resolve(node)`: variables are already applied.

import type { NodeId, SceneNode } from '../../document/types';
import type { FrameResult } from '../types';
import type { DrawContext } from './context';
import { toCanvasKitMatrix } from './matrix';
import { drawFills, isIsolatingBlendMode, skiaBlendMode } from './paints';
import { buildNodeShape, type NodeShape } from './shape';
import { drawStrokes } from './strokes';

export function drawScene(context: DrawContext): FrameResult {
	const pageId = context.source.currentPageId();
	if (pageId !== null) drawChildren(context, pageId);
	return { drawn: true, drawnNodes: context.counters.drawnNodes, layers: context.counters.layers };
}

function drawChildren(context: DrawContext, parentId: NodeId): void {
	for (const childId of context.source.children(parentId)) drawNode(context, childId);
}

function drawNode(context: DrawContext, id: NodeId): void {
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
	if (!needsOpacity && !isIsolatingBlendMode(node.blendMode)) return false;
	const { canvasKit, canvas, scope } = context;
	const layerPaint = scope.own(new canvasKit.Paint());
	layerPaint.setAlphaf(node.opacity);
	layerPaint.setBlendMode(skiaBlendMode(context, node.blendMode));
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
