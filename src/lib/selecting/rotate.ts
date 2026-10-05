// Rotation math for the transform handles (docs/research/interactions.md section 4). Pure.
//
// Rotating is applied to the absolute transform of every selected top-level node about one
// common centre (the node's own centre for one node, the centre of the combined bounds for
// several) and converted back into the parent's space. Descendants keep their local transforms
// and rotate along with their parent.

import {
	composeMatrices,
	invertMatrix,
	planSetProps,
	transformPoint,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type NodeId
} from '../document';
import { isPositioned, topLevelIds, unionBounds } from '../editing/selectionOps';
import type { Point } from '../tools/protocol';

export const SNAP_STEP_DEGREES = 15;
const STEP_RADIANS = (SNAP_STEP_DEGREES * Math.PI) / 180;

/** Rotation by `angle` radians about `centre`. */
export function rotationAbout(centre: Point, angle: number): Matrix2x3 {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [
		[cos, -sin, centre.x - cos * centre.x + sin * centre.y],
		[sin, cos, centre.y - sin * centre.x - cos * centre.y]
	];
}

/** Direction of `point` as seen from `centre`, in radians (0 points right, y grows downward). */
export function angleAround(centre: Point, point: Point): number {
	return Math.atan2(point.y - centre.y, point.x - centre.x);
}

/** Equivalent of `angle` in (-PI, PI]. */
export function normalizeAngle(angle: number): number {
	let result = angle % (2 * Math.PI);
	if (result > Math.PI) result -= 2 * Math.PI;
	if (result <= -Math.PI) result += 2 * Math.PI;
	return result;
}

/**
 * Shift: the resulting orientation (`startAngle + delta`) lands on a multiple of 15 degrees, so a
 * node that began at 7 degrees snaps to 15, 30, ... and not to 22, 37, ...
 */
export function snapRotation(startAngle: number, delta: number): number {
	const snapped = Math.round((startAngle + delta) / STEP_RADIANS) * STEP_RADIANS;
	return snapped - startAngle;
}

export function toDegrees(angle: number): number {
	return (angle * 180) / Math.PI;
}

/** Orientation of a transform's x axis, in radians. */
export function rotationOf(transform: Matrix2x3): number {
	return Math.atan2(transform[1][0], transform[0][0]);
}

export interface RotatePlan {
	changes: Change[];
	/** Orientation of the selection after the rotation, in degrees within (-180, 180]. */
	degrees: number;
}

/**
 * A rotation gesture over a fixed set of nodes. Snapshots the nodes when it starts, so planning
 * on every pointer move always works from the start state.
 */
export class RotateSession {
	readonly rootIds: NodeId[];
	readonly centre: Point;
	/** Orientation the selection started with: the node's own for one node, 0 for several. */
	readonly startAngle: number;
	private readonly absolute = new Map<NodeId, Matrix2x3>();

	constructor(
		private readonly reader: DocumentReader,
		ids: readonly NodeId[]
	) {
		this.rootIds = topLevelIds(reader, ids).filter((id) => {
			const node = reader.requireNode(id);
			return isPositioned(node) && !node.locked;
		});
		for (const id of this.rootIds) this.absolute.set(id, reader.cache.absoluteTransform(id));
		this.centre = this.findCentre();
		this.startAngle = this.findStartAngle();
	}

	get isEmpty(): boolean {
		return this.rootIds.length === 0;
	}

	/** Rotate by `delta` radians (already snapped if the caller wants it). */
	plan(delta: number): RotatePlan {
		const rotation = rotationAbout(this.centre, delta);
		const changes: Change[] = [];
		for (const id of this.rootIds) {
			const transform = this.parentSpace(id, composeMatrices(rotation, this.absoluteOf(id)));
			changes.push(...planSetProps(this.reader, id, { transform }));
		}
		const degrees = toDegrees(normalizeAngle(this.startAngle + delta));
		return { changes, degrees };
	}

	private absoluteOf(id: NodeId): Matrix2x3 {
		const matrix = this.absolute.get(id);
		if (matrix === undefined) throw new Error(`rotate session has no node ${id}`);
		return matrix;
	}

	private findCentre(): Point {
		if (this.rootIds.length === 1) {
			const node = this.reader.requireNode(this.rootIds[0]);
			if (!isPositioned(node)) return { x: 0, y: 0 };
			return transformPoint(this.absoluteOf(node.id), node.width / 2, node.height / 2);
		}
		const bounds = unionBounds(this.rootIds.map((id) => this.reader.cache.absoluteBounds(id)));
		return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	}

	private findStartAngle(): number {
		if (this.rootIds.length !== 1) return 0;
		return rotationOf(this.absoluteOf(this.rootIds[0]));
	}

	private parentSpace(id: NodeId, absolute: Matrix2x3): Matrix2x3 {
		const node = this.reader.requireNode(id);
		if (node.parentId === null) return absolute;
		const parent = this.reader.requireNode(node.parentId);
		if (parent.type === 'PAGE') return absolute;
		const inverse = invertMatrix(this.reader.cache.absoluteTransform(node.parentId));
		if (inverse === null) return absolute;
		return composeMatrices(inverse, absolute);
	}
}
