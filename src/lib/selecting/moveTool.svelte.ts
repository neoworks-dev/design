// The Move tool: the default tool, where clicking selects (docs/research/interactions.md
// section 3). This file is the tool's state machine; picking rules live in pick.ts.
//
//   press on an object   selects it now (so a drag moves it); Shift toggles it; pressing a
//                        selected object in a multi selection waits for the release, because the
//                        press may start a drag of the whole selection
//   press on nothing     a click clears the selection (and resets the scope); a drag draws a marquee
//   double click         enters the selected container or edits text and vector nodes
//   hover                the node a click would select goes to `selection.hoverId`

import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../document';
import type { SelectionSnapshot } from '../services/selection';
import type { ToolContribution } from '../registries/tools.svelte';
import {
	PointerGesture,
	type Point,
	type ToolKeyEvent,
	type ToolPointerEvent
} from '../tools/protocol';
import { marqueeSelect, rectBetween, toggleInto } from './marquee';
import { MoveSession } from './moveSession';
import { enterAt, isDeepSelect, pickAt } from './pick';

/** What the move tool shows besides the selection itself; the overlay component reads it. */
export class MoveToolState {
	/** Marquee rectangle in world space while one is drawn. */
	marquee = $state.raw<{ x: number; y: number; width: number; height: number } | null>(null);
	/** The container a drag would drop into (outlined), when it is not the page. */
	dropTargetId = $state<NodeId | null>(null);
}

type MoveHandlers = Pick<
	ToolContribution,
	| 'onPointerDown'
	| 'onPointerMove'
	| 'onPointerUp'
	| 'onPointerLeave'
	| 'onCancel'
	| 'onDeactivate'
	| 'onKey'
	| 'onKeyUp'
>;

const PRIMARY_BUTTON = 0;
const DOUBLE_CLICK = 2;

type Press =
	| { kind: 'none' }
	| { kind: 'object'; targetId: NodeId; onClick: () => void }
	| { kind: 'empty'; shift: boolean; before: SelectionSnapshot; startWorld: Point };

export function createMoveTool(ctx: Context, state: MoveToolState): MoveHandlers {
	const gesture = new PointerGesture();
	let press: Press = { kind: 'none' };
	let session: MoveSession | undefined;
	let pressWorld: Point = { x: 0, y: 0 };

	const reset = (): void => {
		session?.cancel();
		session = undefined;
		gesture.cancel();
		press = { kind: 'none' };
		state.marquee = null;
		state.dropTargetId = null;
	};

	return {
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON) return;
			ctx.selection.setHover(null);
			if (event.detail >= DOUBLE_CLICK) {
				enter(ctx, event);
				return;
			}
			gesture.press(event.screen);
			pressWorld = event.world;
			press = pressAt(ctx, event);
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (gesture.phase === 'idle') {
				hover(ctx, event);
				return;
			}
			const update = gesture.move(event.screen);
			if (update.phase !== 'dragging') return;
			if (press.kind === 'empty') marqueeTo(ctx, state, press, event);
			if (press.kind !== 'object') return;
			if (update.startedDragging) session = MoveSession.begin(ctx, state, pressWorld, event);
			session?.update(event.world, event);
		},
		onPointerUp(): void {
			const result = gesture.release();
			const finished = press;
			press = { kind: 'none' };
			state.marquee = null;
			if (result === 'drag') session?.commit();
			session = undefined;
			if (result !== 'click') return;
			if (finished.kind === 'object') finished.onClick();
			if (finished.kind === 'empty' && !finished.shift) ctx.selection.clear();
		},
		onPointerLeave(): void {
			ctx.selection.setHover(null);
		},
		onCancel(): boolean {
			if (gesture.phase === 'idle') return false;
			if (press.kind === 'empty' && state.marquee !== null) ctx.selection.restore(press.before);
			reset();
			return true;
		},
		onKey(event: ToolKeyEvent): boolean {
			if (session === undefined) return false;
			if (event.code === 'Space') session.setPinned(true);
			else if (event.key === 'Shift') session.refresh({ ...event, shiftKey: true });
			else return false;
			return true;
		},
		onKeyUp(event: ToolKeyEvent): void {
			if (session === undefined) return;
			if (event.code === 'Space') session.setPinned(false);
			else if (event.key === 'Shift') session.refresh({ ...event, shiftKey: false });
		},
		onDeactivate(): void {
			reset();
			ctx.selection.setHover(null);
		}
	};
}

function hover(ctx: Context, event: ToolPointerEvent): void {
	const id = pickAt(ctx, event.world, event);
	if (id === undefined) {
		ctx.selection.setHover(null);
		return;
	}
	ctx.selection.setHover(id);
}

/** Live marquee: the selection follows the rectangle; Shift toggles against the old selection. */
function marqueeTo(
	ctx: Context,
	state: MoveToolState,
	press: Extract<Press, { kind: 'empty' }>,
	event: ToolPointerEvent
): void {
	state.marquee = rectBetween(press.startWorld, event.world);
	const scopeId = ctx.selection.scopeId;
	const found = marqueeSelect(ctx.document.reader, {
		pageId: ctx.document.currentPageId,
		scopeId: scopeId === null ? ctx.document.currentPageId : scopeId,
		rect: state.marquee,
		deep: isDeepSelect(event)
	});
	const ids = press.shift ? toggleInto(press.before.ids, found) : found;
	ctx.selection.select(ids, 'replace', { source: 'canvas' });
}

function enter(ctx: Context, event: ToolPointerEvent): void {
	const result = enterAt(ctx, event.world, event);
	if (result.kind === 'entered') {
		ctx.selection.select([result.id], 'replace', { source: 'canvas' });
		return;
	}
	if (result.kind === 'edit') ctx.emit('canvas/edit-request', result.id, result.editor);
}

function pressAt(ctx: Context, event: ToolPointerEvent): Press {
	const targetId = pickAt(ctx, event.world, event);
	if (targetId === undefined) {
		return {
			kind: 'empty',
			shift: event.shiftKey,
			before: ctx.selection.snapshot(),
			startWorld: event.world
		};
	}
	const selected = ctx.selection.has(targetId);
	if (event.shiftKey) return pressWithShift(ctx, targetId, selected);
	if (selected) return pressOnSelected(ctx, targetId);
	ctx.selection.select([targetId], 'replace', { source: 'canvas' });
	return { kind: 'object', targetId, onClick: () => undefined };
}

/** Shift: add an unselected node now; toggle a selected one off only if the press was a click. */
function pressWithShift(ctx: Context, targetId: NodeId, selected: boolean): Press {
	if (!selected) {
		ctx.selection.select([targetId], 'add', { source: 'canvas' });
		return { kind: 'object', targetId, onClick: () => undefined };
	}
	return {
		kind: 'object',
		targetId,
		onClick: () => ctx.selection.select([targetId], 'remove', { source: 'canvas' })
	};
}

/** A selected node in a multi selection narrows the selection to itself on a click. */
function pressOnSelected(ctx: Context, targetId: NodeId): Press {
	if (ctx.selection.count === 1) return { kind: 'object', targetId, onClick: () => undefined };
	return {
		kind: 'object',
		targetId,
		onClick: () => ctx.selection.select([targetId], 'replace', { source: 'canvas' })
	};
}
