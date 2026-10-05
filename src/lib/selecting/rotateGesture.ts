// One rotate gesture (issue #53): pointer down in a rotation zone opens a history group, every
// move re-plans from the start state, release closes the group (one undo step), Esc cancels it.
// Shift snaps the resulting orientation to 15 degree steps.

import type { Context } from '@neoworks/extension-system';
import type { Modifiers, Point } from '../tools/protocol';
import { angleAround, normalizeAngle, RotateSession, snapRotation } from './rotate';

export interface RotateFeedback {
	/** Orientation in degrees while a rotation runs, for the readout. */
	angle: number | null;
}

interface ActiveRotation {
	session: RotateSession;
	startPointerAngle: number;
	group: ReturnType<Context['history']['beginGroup']>;
	lastWorld: Point;
}

export class RotateGesture {
	private active: ActiveRotation | undefined;

	constructor(
		private readonly ctx: Context,
		private readonly feedback: RotateFeedback
	) {}

	get isActive(): boolean {
		return this.active !== undefined;
	}

	begin(world: Point): boolean {
		const session = new RotateSession(this.ctx.document.reader, this.ctx.selection.ids);
		if (session.isEmpty) return false;
		const group = this.ctx.history.beginGroup({ label: 'Rotate' });
		const startPointerAngle = angleAround(session.centre, world);
		this.active = { session, startPointerAngle, group, lastWorld: world };
		return true;
	}

	update(world: Point, modifiers: Modifiers): void {
		const active = this.active;
		if (active === undefined) return;
		active.lastWorld = world;
		let delta = normalizeAngle(
			angleAround(active.session.centre, world) - active.startPointerAngle
		);
		if (modifiers.shiftKey) delta = snapRotation(active.session.startAngle, delta);
		const plan = active.session.plan(delta);
		if (plan.changes.length > 0) {
			this.ctx.document.apply(plan.changes, { origin: 'user', label: 'Rotate' });
		}
		this.feedback.angle = plan.degrees;
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
		this.feedback.angle = null;
	}
}
