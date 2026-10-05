// Reading corner radii for the appearance section: a node stores one number or one per corner.

import type { BlendMode, Node } from '../../lib/document';

export type Corners = [number, number, number, number];

/** Radius of each corner (top left, top right, bottom right, bottom left). */
export function cornersOf(node: Node): Corners {
	if (!('cornerRadius' in node)) return [0, 0, 0, 0];
	const radius = node.cornerRadius;
	if (typeof radius === 'number') return [radius, radius, radius, radius];
	return [...radius];
}

/** The one radius of all four corners, or `null` when the corners differ. */
export function uniformRadius(node: Node): number | null {
	const [first, ...rest] = cornersOf(node);
	if (rest.every((radius) => radius === first)) return first;
	return null;
}

export function blendLabel(mode: BlendMode): string {
	const words = mode.toLowerCase().split('_').join(' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}
