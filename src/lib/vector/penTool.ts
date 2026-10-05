// The pen tool (issue #60): pointer handlers on top of PenSession, the commit as one change set
// and the overlay that previews the path. The session lives in the draft's local coordinates; a
// new draft uses the container under the first point, an existing vector (selected, one of its
// vertices clicked) continues in its own space.

import type { Context } from '@neoworks/extension-system';
import type { ToolContribution } from '../registries/tools.svelte';
import type { OverlayContribution } from '../overlay/types';
import type { ToolKeyEvent, ToolPointerEvent } from '../tools/protocol';
import {
	createVectorNode,
	existingDraftSpace,
	newDraftSpace,
	updateVectorNode,
	worldToDraft,
	type DraftSpace
} from './createVector';
import { cubicPoint, type Point } from './geometry';
import { drawNetworkOverlay, toScreen } from './overlayDraw';
import { PenSession } from './penSession';
import { Revision } from './revision.svelte';

const HIT_RADIUS_PIXELS = 6;
const PRIMARY_BUTTON = 0;

export class PenState {
	session: PenSession | null = null;
	space: DraftSpace | null = null;
	readonly revision = new Revision();
}

type PenHandlers = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onKey' | 'onCancel' | 'onDeactivate'
>;

function spaceScale(space: DraftSpace): number {
	const [[a, c], [b, d]] = space.toWorld;
	const scale = Math.sqrt(Math.abs(a * d - b * c));
	if (scale === 0) return 1;
	return scale;
}

function hitRadius(ctx: Context, space: DraftSpace): number {
	return HIT_RADIUS_PIXELS / ctx.viewport.zoom / spaceScale(space);
}

/** The selected vector, when the click lands on one of its vertices: continue or branch it. */
function existingTarget(ctx: Context, world: Point): DraftSpace | null {
	const id = ctx.selection.primaryId;
	if (id === null) return null;
	const node = ctx.document.get(id);
	if (!node || node.type !== 'VECTOR') return null;
	const space = existingDraftSpace(ctx, id);
	const local = worldToDraft(space, world);
	const session = new PenSession(node.network);
	if (session.vertexAt(local, hitRadius(ctx, space)) < 0) return null;
	return space;
}

function startSession(ctx: Context, state: PenState, world: Point): void {
	const existing = existingTarget(ctx, world);
	if (existing && existing.nodeId !== undefined) {
		const node = ctx.document.require(existing.nodeId);
		if (node.type === 'VECTOR') {
			state.space = existing;
			state.session = new PenSession(node.network);
			return;
		}
	}
	state.space = newDraftSpace(ctx, world);
	state.session = new PenSession();
}

/** Commits the draft as one undo step and ends the session (the tool stays active). */
export function commitPen(ctx: Context, state: PenState): void {
	const { session, space } = state;
	state.session = null;
	state.space = null;
	state.revision.bump();
	if (!session || !space) return;
	const network = session.finish();
	if (!network) return;
	if (space.nodeId !== undefined) {
		updateVectorNode(ctx, space.nodeId, network, 'Edit vector');
		return;
	}
	createVectorNode(ctx, network, space.container, { label: 'Create vector' });
}

export function createPenTool(ctx: Context, state: PenState): PenHandlers {
	const finish = (): void => commitPen(ctx, state);
	return {
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON) return;
			if (!state.session) startSession(ctx, state, event.world);
			const { session, space } = state;
			if (!session || !space) return;
			const local = worldToDraft(space, event.world);
			const result = session.press(local, hitRadius(ctx, space), event.shiftKey);
			state.revision.bump();
			if (result === 'closed' || result === 'connected') finish();
		},
		onPointerMove(event: ToolPointerEvent): void {
			const { session, space } = state;
			if (!session || !space) return;
			const local = worldToDraft(space, event.world);
			if (session.isDragging) session.drag(local);
			else session.hover(local, event.shiftKey);
			state.revision.bump();
		},
		onPointerUp(): void {
			state.session?.release();
			state.revision.bump();
		},
		onKey(event: ToolKeyEvent): boolean {
			const session = state.session;
			if (!session) return false;
			if (event.key === 'Enter') {
				event.preventDefault();
				finish();
				return true;
			}
			const isUndo = event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey);
			if (!isUndo || event.shiftKey) return false;
			event.preventDefault();
			if (!session.undoLastPoint()) {
				state.session = null;
				state.space = null;
			}
			state.revision.bump();
			return true;
		},
		onCancel(): boolean {
			if (!state.session) return false;
			finish();
			return true;
		},
		onDeactivate: finish
	};
}

function previewCurve(frame: Parameters<OverlayContribution['draw']>[0], state: PenState): void {
	const { session, space } = state;
	if (!session || !space || session.active === null || !session.cursor) return;
	const from = session.network.vertices[session.active];
	const handle = session.outHandles.get(session.active);
	const controls = {
		start: from,
		firstControl: handle ? { x: from.x + handle.x, y: from.y + handle.y } : from,
		secondControl: session.cursor,
		end: session.cursor
	};
	const { ctx } = frame;
	ctx.strokeStyle = '#0d99ff';
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 3]);
	ctx.beginPath();
	const start = toScreen(frame, space.toWorld, controls.start);
	ctx.moveTo(start.x, start.y);
	for (let step = 1; step <= 20; step += 1) {
		const point = toScreen(frame, space.toWorld, cubicPoint(controls, step / 20));
		ctx.lineTo(point.x, point.y);
	}
	ctx.stroke();
	ctx.setLineDash([]);
}

function drawOutHandles(frame: Parameters<OverlayContribution['draw']>[0], state: PenState): void {
	const { session, space } = state;
	if (!session || !space) return;
	for (const [vertex, handle] of session.outHandles) {
		const origin = session.network.vertices[vertex];
		const from = toScreen(frame, space.toWorld, origin);
		const to = toScreen(frame, space.toWorld, { x: origin.x + handle.x, y: origin.y + handle.y });
		frame.ctx.strokeStyle = '#0d99ff';
		frame.ctx.lineWidth = 1;
		frame.ctx.beginPath();
		frame.ctx.moveTo(from.x, from.y);
		frame.ctx.lineTo(to.x, to.y);
		frame.ctx.stroke();
		frame.ctx.beginPath();
		frame.ctx.arc(to.x, to.y, 3, 0, Math.PI * 2);
		frame.ctx.stroke();
	}
}

function ringOnClosablePoint(
	frame: Parameters<OverlayContribution['draw']>[0],
	state: PenState,
	radius: number
): void {
	const { session, space } = state;
	if (!session || !space || !session.cursor || session.chainStart === null) return;
	if (!session.canCloseAt(session.cursor, radius)) return;
	const at = toScreen(frame, space.toWorld, session.network.vertices[session.chainStart]);
	frame.ctx.strokeStyle = '#0d99ff';
	frame.ctx.lineWidth = 2;
	frame.ctx.beginPath();
	frame.ctx.arc(at.x, at.y, 8, 0, Math.PI * 2);
	frame.ctx.stroke();
}

/** Overlay: the draft path with its points and handles, the rubber band and the close ring. */
export function penOverlay(ctx: Context, state: PenState): OverlayContribution {
	return {
		id: 'tool-pen/draft',
		order: 50,
		track: () => void state.revision.value,
		draw(frame): void {
			const { session, space } = state;
			if (!session || !space) return;
			const selected = new Set<number>();
			if (session.active !== null) selected.add(session.active);
			drawNetworkOverlay(frame, space.toWorld, session.network, {
				selectedVertices: selected,
				handleVertices: new Set(session.outHandles.keys())
			});
			drawOutHandles(frame, state);
			previewCurve(frame, state);
			ringOnClosablePoint(frame, state, hitRadius(ctx, space));
		}
	};
}
