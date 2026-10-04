// 2x3 affine matrices: [[a, c, e], [b, d, f]] maps (x, y) to (a*x + c*y + e, b*x + d*y + f).

import type { Matrix2x3, Rect } from './types';

export function identityMatrix(): Matrix2x3 {
	return [
		[1, 0, 0],
		[0, 1, 0]
	];
}

/** `parent` applied after `child`: the child's local space expressed in the parent's parent. */
export function composeMatrices(parent: Matrix2x3, child: Matrix2x3): Matrix2x3 {
	const [[pa, pc, pe], [pb, pd, pf]] = parent;
	const [[ca, cc, ce], [cb, cd, cf]] = child;
	return [
		[pa * ca + pc * cb, pa * cc + pc * cd, pa * ce + pc * cf + pe],
		[pb * ca + pd * cb, pb * cc + pd * cd, pb * ce + pd * cf + pf]
	];
}

export function transformPoint(matrix: Matrix2x3, x: number, y: number): { x: number; y: number } {
	const [[a, c, e], [b, d, f]] = matrix;
	return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** Axis-aligned bounds of the box (0, 0, width, height) after `matrix`. */
export function transformedBounds(matrix: Matrix2x3, width: number, height: number): Rect {
	const corners = [
		transformPoint(matrix, 0, 0),
		transformPoint(matrix, width, 0),
		transformPoint(matrix, 0, height),
		transformPoint(matrix, width, height)
	];
	const xs = corners.map((corner) => corner.x);
	const ys = corners.map((corner) => corner.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
