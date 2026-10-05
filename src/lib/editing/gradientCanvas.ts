// Where the gradient handles are on the canvas, and which one a pointer is on. Pure.

import { composeMatrices, invertMatrix, transformPoint } from '../document/matrix';
import type { GradientPaint, Matrix2x3, Vec2 } from '../document/types';
import { handlePoints, hasAxisStops, type HandleName } from './gradient';

/** Maps between the node's normalized box (0..1) and world (page) coordinates. */
export class NodeSpace {
	private readonly toWorldMatrix: Matrix2x3;
	private readonly toNormalizedMatrix: Matrix2x3 | null;

	constructor(
		absolute: Matrix2x3,
		readonly size: { width: number; height: number }
	) {
		const scale: Matrix2x3 = [
			[size.width, 0, 0],
			[0, size.height, 0]
		];
		this.toWorldMatrix = composeMatrices(absolute, scale);
		this.toNormalizedMatrix = invertMatrix(this.toWorldMatrix);
	}

	toWorld(point: Vec2): Vec2 {
		return transformPoint(this.toWorldMatrix, point.x, point.y);
	}

	toNormalized(world: Vec2): Vec2 {
		if (this.toNormalizedMatrix === null) return { x: 0, y: 0 };
		return transformPoint(this.toNormalizedMatrix, world.x, world.y);
	}
}

export type HandleTarget = { kind: 'handle'; handle: HandleName } | { kind: 'stop'; index: number };

export interface PlacedTarget {
	target: HandleTarget;
	/** World position of the handle. */
	world: Vec2;
}

/** Every grabbable thing of a gradient, handles first so they win a tie. */
export function placedTargets(paint: GradientPaint, space: NodeSpace): PlacedTarget[] {
	const points = handlePoints(paint);
	const placed: PlacedTarget[] = [
		{ target: { kind: 'handle', handle: 'origin' }, world: space.toWorld(points.origin) },
		{ target: { kind: 'handle', handle: 'end' }, world: space.toWorld(points.end) },
		{ target: { kind: 'handle', handle: 'width' }, world: space.toWorld(points.width) }
	];
	if (!hasAxisStops(paint.type)) return placed;
	paint.gradientStops.forEach((stop, index) => {
		const along = {
			x: points.origin.x + (points.end.x - points.origin.x) * stop.position,
			y: points.origin.y + (points.end.y - points.origin.y) * stop.position
		};
		placed.push({ target: { kind: 'stop', index }, world: space.toWorld(along) });
	});
	return placed;
}

/** The nearest target within `radius` world units of `world`; handles beat stops on a tie. */
export function hitTarget(
	paint: GradientPaint,
	space: NodeSpace,
	world: Vec2,
	radius: number
): HandleTarget | undefined {
	let best: HandleTarget | undefined;
	let bestDistance = radius;
	for (const placed of placedTargets(paint, space)) {
		const distance = Math.hypot(placed.world.x - world.x, placed.world.y - world.y);
		if (distance >= bestDistance) continue;
		best = placed.target;
		bestDistance = distance;
	}
	return best;
}
