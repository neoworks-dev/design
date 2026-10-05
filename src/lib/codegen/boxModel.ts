// The box model preview of the Inspect panel, pure: the size of a node, its border and (for an
// auto layout frame) its padding.

import type { Node } from '../document';

export interface BoxModel {
	width: number;
	height: number;
	border: number;
	padding: { top: number; right: number; bottom: number; left: number };
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function borderWidth(node: Node): number {
	if (!('strokes' in node)) return 0;
	let widest = 0;
	for (const stroke of node.strokes) {
		const weight = typeof stroke.weight === 'number' ? stroke.weight : stroke.weight.top;
		widest = Math.max(widest, weight);
	}
	return widest;
}

function paddingOf(node: Node): BoxModel['padding'] {
	if (!('paddingTop' in node) || node.layoutMode === 'NONE') {
		return { top: 0, right: 0, bottom: 0, left: 0 };
	}
	return {
		top: node.paddingTop,
		right: node.paddingRight,
		bottom: node.paddingBottom,
		left: node.paddingLeft
	};
}

/** `null` for nodes without a box (pages). */
export function boxModelOf(node: Node): BoxModel | null {
	if (node.type === 'PAGE') return null;
	return {
		width: round(node.width),
		height: round(node.height),
		border: round(borderWidth(node)),
		padding: paddingOf(node)
	};
}
