// Masks (#37). A node with `isMask` masks every sibling above it in its container (the ones
// drawn after it), as in Figma. The masked siblings are drawn into one isolated layer; the mask
// is then drawn into a second layer composited with DstIn, which keeps the content only where
// the mask has alpha. Three mask types:
//   ALPHA      the mask drawn as it looks (fills, strokes, opacity) and its alpha is used
//   VECTOR     the mask's outline only, as if filled opaque: fills and strokes are ignored
//   LUMINANCE  the mask drawn as it looks, then its luminance becomes the alpha (luma filter)
// The mask node itself never shows. A hidden mask masks nothing.

import type { NodeId, SceneNode } from '../../document/types';
import type { DrawContext } from './context';
import { toCanvasKitMatrix } from './matrix';
import { buildNodeShape } from './shape';

export function isMaskNode(node: SceneNode): boolean {
	if (!('isMask' in node)) return false;
	return node.isMask;
}

export type DrawNode = (context: DrawContext, id: NodeId) => void;

/** Draws `maskedIds` masked by `maskNode`; `drawNode` draws one node with all its decoration. */
export function drawMasked(
	context: DrawContext,
	maskNode: SceneNode,
	maskedIds: readonly NodeId[],
	drawSiblings: (ids: readonly NodeId[]) => void,
	drawNode: DrawNode
): void {
	const { canvas, canvasKit, scope } = context;
	canvas.saveLayer();
	context.counters.layers += 1;
	drawSiblings(maskedIds);
	const maskPaint = scope.own(new canvasKit.Paint());
	maskPaint.setBlendMode(canvasKit.BlendMode.DstIn);
	if (maskTypeOf(maskNode) === 'LUMINANCE') {
		maskPaint.setColorFilter(scope.own(canvasKit.ColorFilter.MakeLuma()));
	}
	canvas.saveLayer(maskPaint);
	context.counters.layers += 1;
	drawMaskShape(context, maskNode, drawNode);
	canvas.restore();
	canvas.restore();
}

function maskTypeOf(node: SceneNode): 'ALPHA' | 'VECTOR' | 'LUMINANCE' {
	if (!('maskType' in node)) return 'ALPHA';
	return node.maskType;
}

function drawMaskShape(context: DrawContext, maskNode: SceneNode, drawNode: DrawNode): void {
	if (maskTypeOf(maskNode) !== 'VECTOR') {
		drawNode(context, maskNode.id);
		return;
	}
	const { canvas, canvasKit, scope } = context;
	canvas.save();
	canvas.concat(toCanvasKitMatrix(maskNode.transform));
	const shape = buildNodeShape(context, maskNode);
	if (shape && shape.fillPath) {
		const paint = scope.own(new canvasKit.Paint());
		paint.setAntiAlias(true);
		paint.setColor(canvasKit.BLACK);
		canvas.drawPath(shape.fillPath, paint);
	}
	canvas.restore();
}
