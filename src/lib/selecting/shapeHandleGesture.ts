// One drag of a shape handle (issue #54): a history group opens on press, every move sets the
// property from the node as it was at the start, release closes the group (one undo step) and
// Esc cancels it.

import type { Context } from '@neoworks/extension-system';
import {
	invertMatrix,
	planSetProps,
	transformPoint,
	type Matrix2x3,
	type NodeId
} from '../document';
import type { Modifiers, Point } from '../tools/protocol';
import {
	dragShapeHandle,
	handleReadout,
	hasShapeHandles,
	type HandledNode,
	type ShapeHandle
} from './shapeHandles';

export interface ShapeHandleFeedback {
	/** Number or angle next to the dragged handle. */
	readout: { text: string; world: Point } | null;
}

interface ActiveDrag {
	id: NodeId;
	/** The node as it was when the drag began: every update computes from it. */
	startNode: HandledNode;
	handle: ShapeHandle;
	absolute: Matrix2x3;
	inverse: Matrix2x3;
	pointerAtStart: Point;
	pixelsPerUnit: number;
	group: ReturnType<Context['history']['beginGroup']>;
	lastWorld: Point;
}

const LABELS: Record<ShapeHandle['kind'], string> = {
	radius: 'Corner radius',
	arcStart: 'Arc start',
	arcEnd: 'Arc sweep',
	arcInner: 'Arc inner radius',
	pointCount: 'Point count',
	starInner: 'Star inner ratio'
};

export class ShapeHandleGesture {
	private active: ActiveDrag | undefined;

	constructor(
		private readonly ctx: Context,
		private readonly feedback: ShapeHandleFeedback
	) {}

	get isActive(): boolean {
		return this.active !== undefined;
	}

	begin(id: NodeId, handle: ShapeHandle, world: Point, pixelsPerUnit: number): boolean {
		const node = this.ctx.document.require(id);
		if (!hasShapeHandles(node) || node.locked) return false;
		const absolute = this.ctx.document.absoluteTransform(id);
		const inverse = invertMatrix(absolute);
		if (inverse === null) return false;
		const group = this.ctx.history.beginGroup({ label: LABELS[handle.kind] });
		const pointerAtStart = transformPoint(inverse, world.x, world.y);
		this.active = {
			id,
			startNode: { ...node },
			handle,
			absolute,
			inverse,
			pointerAtStart,
			pixelsPerUnit,
			group,
			lastWorld: world
		};
		return true;
	}

	update(world: Point, modifiers: Modifiers): void {
		const active = this.active;
		if (active === undefined) return;
		active.lastWorld = world;
		const pointer = transformPoint(active.inverse, world.x, world.y);
		const props = dragShapeHandle(active.startNode, active.handle, pointer, modifiers, active);
		const changes = planSetProps(this.ctx.document.reader, active.id, props);
		if (changes.length > 0) {
			this.ctx.document.apply(changes, { origin: 'user', label: LABELS[active.handle.kind] });
		}
		const updated = this.ctx.document.require(active.id);
		if (!hasShapeHandles(updated)) return;
		this.feedback.readout = { text: handleReadout(updated, active.handle), world };
	}

	refresh(modifiers: Modifiers): void {
		if (this.active === undefined) return;
		this.update(this.active.lastWorld, modifiers);
	}

	commit(): void {
		const active = this.active;
		if (active === undefined) return;
		this.finish();
		this.ctx.history.endGroup(active.group);
	}

	cancel(): void {
		const active = this.active;
		if (active === undefined) return;
		this.finish();
		this.ctx.history.cancelGroup(active.group);
	}

	private finish(): void {
		this.active = undefined;
		this.feedback.readout = null;
	}
}
