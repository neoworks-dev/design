// The Scale tool's gesture maths (issue #55): the same handles and snapshots as a resize, but the
// proportions are always kept and the whole subtree scales with the node (text size, strokes,
// effects, radii, spacing), whatever its constraints and auto layout say. Pure.

import {
	composeMatrices,
	invertMatrix,
	scaleEdits,
	editsToChanges,
	type Matrix2x3,
	type ScaleEdits,
	type ScaleSource
} from '../document';
import {
	boxAffine,
	ratioOf,
	resizeBox,
	ResizeSession,
	scaleTransform,
	type ResizePlan,
	type ResizeRequest
} from './resize';

export class ScaleSession extends ResizeSession {
	plan(request: ResizeRequest): ResizePlan {
		const proportional = { ...request, modifiers: { ...request.modifiers, shiftKey: true } };
		if (this.rootIds.length === 1) return this.planSingleScale(proportional);
		return this.planMultipleScale(proportional);
	}

	private get snapshot(): ScaleSource {
		return {
			node: (id) => this.nodeOf(id),
			children: (id) => this.childIdsOf(id)
		};
	}

	private childIdsOf(id: string): readonly string[] {
		const kids = this.childIds.get(id);
		if (kids === undefined) return [];
		return kids;
	}

	private planSingleScale(request: ResizeRequest): ResizePlan {
		const id = this.rootIds[0];
		const node = this.nodeOf(id);
		const linear = this.absoluteOf(id);
		const inverse = invertMatrix([
			[linear[0][0], linear[0][1], 0],
			[linear[1][0], linear[1][1], 0]
		]);
		let local = request.delta;
		if (inverse !== null) {
			local = {
				x: inverse[0][0] * request.delta.x + inverse[0][1] * request.delta.y,
				y: inverse[1][0] * request.delta.x + inverse[1][1] * request.delta.y
			};
		}
		const box = resizeBox(
			{ width: node.width, height: node.height },
			request.handle,
			local,
			request.modifiers
		);
		const transform = composeMatrices(node.transform, boxAffine(box));
		const edits = scaleEdits(this.snapshot, id, {
			transform,
			width: box.width,
			height: box.height
		});
		return this.resultOf(edits, box);
	}

	private planMultipleScale(request: ResizeRequest): ResizePlan {
		const bounds = this.startBounds;
		const box = resizeBox(
			{ width: bounds.width, height: bounds.height },
			request.handle,
			request.delta,
			request.modifiers
		);
		const kx = ratioOf(box.width, bounds.width) * (box.flipX ? -1 : 1);
		const ky = ratioOf(box.height, bounds.height) * (box.flipY ? -1 : 1);
		const factors = {
			kx,
			ky,
			tx: bounds.x + box.originX - kx * bounds.x,
			ty: bounds.y + box.originY - ky * bounds.y
		};
		const edits: ScaleEdits = new Map();
		for (const id of this.rootIds) {
			const node = this.nodeOf(id);
			const scaled = scaleTransform(this.absoluteOf(id), node.width, node.height, factors);
			const transform: Matrix2x3 = this.toParentSpace(node, scaled.transform);
			const target = { transform, width: scaled.width, height: scaled.height };
			for (const [editedId, props] of scaleEdits(this.snapshot, id, target)) {
				edits.set(editedId, props);
			}
		}
		return this.resultOf(edits, box);
	}

	private resultOf(edits: ScaleEdits, size: { width: number; height: number }): ResizePlan {
		return {
			changes: editsToChanges(this.reader, edits),
			size: { width: size.width, height: size.height }
		};
	}
}
