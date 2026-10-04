import type { Matrix2x3 } from '../../document/types';

/** Row-major 3x3 as CanvasKit's `concat` and shader local matrices take it. */
export function toCanvasKitMatrix(matrix: Matrix2x3): number[] {
	const [[a, c, e], [b, d, f]] = matrix;
	return [a, c, e, b, d, f, 0, 0, 1];
}
