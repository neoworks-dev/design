// Walks the current page and draws it. Placeholder until #34 (scene drawing): flat solid fills of
// every node's first visible solid paint, so the render loop, camera and surface can be verified.

import type { FrameResult } from '../types';
import { toCanvasKitMatrix } from './matrix';
import type { DrawContext } from './context';
import type { NodeId } from '../../document/types';

export function drawScene(context: DrawContext): FrameResult {
	const pageId = context.source.currentPageId();
	if (pageId !== null) drawChildren(context, pageId);
	return { drawn: true, drawnNodes: context.counters.drawnNodes, layers: context.counters.layers };
}

function drawChildren(context: DrawContext, parentId: NodeId): void {
	for (const childId of context.source.children(parentId)) drawNode(context, childId);
}

function drawNode(context: DrawContext, id: NodeId): void {
	const { canvasKit, canvas, scope, source } = context;
	const stored = source.getNode(id);
	if (!stored || stored.type === 'PAGE') return;
	const node = source.resolve(stored);
	if (!node.visible) return;
	canvas.save();
	canvas.concat(toCanvasKitMatrix(node.transform));
	if ('fills' in node) {
		const solid = node.fills.find((paint) => paint.visible && paint.type === 'SOLID');
		if (solid && solid.type === 'SOLID') {
			const paint = scope.own(new canvasKit.Paint());
			paint.setColor(canvasKit.Color4f(solid.color.r, solid.color.g, solid.color.b, solid.opacity));
			canvas.drawRect(canvasKit.XYWHRect(0, 0, node.width, node.height), paint);
			context.counters.drawnNodes += 1;
		}
	}
	drawChildren(context, id);
	canvas.restore();
}
