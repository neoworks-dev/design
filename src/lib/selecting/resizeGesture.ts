// One resize gesture over the selection (issue #52): pointer down on a handle opens a history
// group, every move re-plans from the start state and applies the changes, release closes the
// group (one undo step), Esc cancels it (no trace). Snapping moves the dragged edges onto
// neighbouring lines; it is skipped for rotated nodes (the lines are axis-aligned) and with Ctrl.

import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import { unionBounds } from '../editing/selectionOps';
import type { Modifiers, Point } from '../tools/protocol';
import {
	HANDLE_POSITION,
	ResizeSession,
	type BoxSize,
	type HandleId,
	type ResizeModifiers,
	type ResizePlan
} from './resize';

export interface ResizeFeedback {
	/** Size of the selection while a gesture runs, for the pill. */
	size: BoxSize | null;
}

interface ActiveResize {
	session: ResizeSession;
	handle: HandleId;
	startWorld: Point;
	group: ReturnType<Context['history']['beginGroup']>;
	lastWorld: Point;
}

type EdgeLines = { x?: readonly ('min' | 'max')[]; y?: readonly ('min' | 'max')[] };

function edgeLines(handle: HandleId): EdgeLines {
	const position = HANDLE_POSITION[handle];
	const lines: EdgeLines = {};
	if (position.u === 0) lines.x = ['min'];
	if (position.u === 1) lines.x = ['max'];
	if (position.v === 0) lines.y = ['min'];
	if (position.v === 1) lines.y = ['max'];
	return lines;
}

function snapAxes(handle: HandleId): 'both' | 'x' | 'y' {
	const position = HANDLE_POSITION[handle];
	if (position.u === 0.5) return 'y';
	if (position.v === 0.5) return 'x';
	return 'both';
}

export class ResizeGesture {
	private active: ActiveResize | undefined;

	constructor(
		private readonly ctx: Context,
		private readonly feedback: ResizeFeedback
	) {}

	get isActive(): boolean {
		return this.active !== undefined;
	}

	begin(handle: HandleId, world: Point): boolean {
		const session = new ResizeSession(this.ctx.document.reader, this.ctx.selection.ids);
		if (session.isEmpty) return false;
		const group = this.ctx.history.beginGroup({ label: 'Resize' });
		this.active = { session, handle, startWorld: world, group, lastWorld: world };
		return true;
	}

	update(world: Point, modifiers: Modifiers): void {
		const active = this.active;
		if (active === undefined) return;
		active.lastWorld = world;
		const raw = { x: world.x - active.startWorld.x, y: world.y - active.startWorld.y };
		let plan = this.planAndApply(active, raw, modifiers);
		const snap = this.snapDelta(active, modifiers);
		if (snap.x !== 0 || snap.y !== 0) {
			plan = this.planAndApply(active, { x: raw.x + snap.x, y: raw.y + snap.y }, modifiers);
		}
		this.feedback.size = plan.size;
	}

	/** Same pointer position, new modifier state (Shift pressed while the pointer rests). */
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
		this.feedback.size = null;
		this.ctx.snapping.release();
	}

	private planAndApply(active: ActiveResize, delta: Point, modifiers: Modifiers): ResizePlan {
		const resizeModifiers: ResizeModifiers = {
			shiftKey: modifiers.shiftKey,
			altKey: modifiers.altKey,
			ctrlKey: modifiers.ctrlKey,
			metaKey: modifiers.metaKey
		};
		const plan = active.session.plan({ handle: active.handle, delta, modifiers: resizeModifiers });
		if (plan.changes.length > 0) {
			this.ctx.document.apply(plan.changes, { origin: 'user', label: 'Resize' });
		}
		return plan;
	}

	/** How far the dragged edges are from a snap line right now. */
	private snapDelta(active: ActiveResize, modifiers: Modifiers): Point {
		const none = { x: 0, y: 0 };
		if (active.session.isRotated) return none;
		const ids: NodeId[] = active.session.rootIds;
		const reader = this.ctx.document.reader;
		const moving = unionBounds(ids.map((id) => reader.cache.absoluteBounds(id)));
		const outcome = this.ctx.snapping.snap(moving, {
			ignoreIds: ids,
			parentId: this.parentOf(ids),
			axes: snapAxes(active.handle),
			lines: edgeLines(active.handle),
			bypass: modifiers.ctrlKey || modifiers.metaKey
		});
		return outcome.delta;
	}

	private parentOf(ids: readonly NodeId[]): NodeId {
		const parents = new Set(ids.map((id) => this.ctx.document.require(id).parentId));
		const [only] = parents;
		if (parents.size === 1 && only !== null) return only;
		return this.ctx.document.currentPageId;
	}
}
