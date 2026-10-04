// A node's own geometry as Skia paths, built once per node per frame and shared by fills, effects,
// strokes and the clip for its children.

import type { Path } from 'canvaskit-wasm';
import { cornerRadiiOf, nodeOutline, type CornerRadii, type Outline } from '../../document/outline';
import type { Size } from '../../kernel/types';
import type { SceneNode } from '../../document/types';
import type { DrawContext } from './context';
import { skiaPath } from './skiaPath';

/** Present for nodes shaped like a rectangle: the only ones that support per-side stroke weights. */
export interface RectangleGeometry {
	width: number;
	height: number;
	radii: CornerRadii;
	smoothing: number;
}

export interface NodeShape {
	outline: Outline;
	size: Size;
	/** Null when the shape cannot be filled (a line, an open vector). */
	fillPath: Path | null;
	strokePath: Path;
	rectangle: RectangleGeometry | null;
}

export function buildNodeShape(context: DrawContext, node: SceneNode): NodeShape | null {
	const outline = nodeOutline(node);
	if (!outline) return null;
	const { fillRule } = outline;
	let fillPath: Path | null = null;
	if (outline.fill.length > 0) fillPath = skiaPath(context, outline.fill, fillRule);
	let strokePath = fillPath;
	if (outline.stroke !== outline.fill || fillPath === null) {
		strokePath = skiaPath(context, outline.stroke, fillRule);
	}
	if (strokePath === null) return null;
	return {
		outline,
		size: { width: node.width, height: node.height },
		fillPath,
		strokePath,
		rectangle: rectangleGeometry(node)
	};
}

function rectangleGeometry(node: SceneNode): RectangleGeometry | null {
	switch (node.type) {
		case 'FRAME':
		case 'COMPONENT':
		case 'COMPONENT_SET':
		case 'INSTANCE':
		case 'RECTANGLE':
			return {
				width: node.width,
				height: node.height,
				radii: cornerRadiiOf(node.cornerRadius),
				smoothing: node.cornerSmoothing
			};
		case 'SECTION':
			return { width: node.width, height: node.height, radii: [0, 0, 0, 0], smoothing: 0 };
		default:
			return null;
	}
}
