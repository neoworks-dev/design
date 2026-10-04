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
import type { ToolContribution } from '../registries/tools.svelte';
import { PointerGesture, type ToolPointerEvent } from '../tools/protocol';
import { enterAt, pickAt } from './pick';

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
	| { kind: 'empty'; shift: boolean };

export function createMoveTool(ctx: Context, state: MoveToolState): MoveHandlers {
	const gesture = new PointerGesture();
	let press: Press = { kind: 'none' };

	const reset = (): void => {
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
			press = pressAt(ctx, event);
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (gesture.phase === 'idle') {
				hover(ctx, event);
				return;
			}
			gesture.move(event.screen);
		},
		onPointerUp(): void {
			const result = gesture.release();
			const finished = press;
			press = { kind: 'none' };
			if (result !== 'click') return;
			if (finished.kind === 'object') finished.onClick();
			if (finished.kind === 'empty' && !finished.shift) ctx.selection.clear();
		},
		onPointerLeave(): void {
			ctx.selection.setHover(null);
		},
		onCancel(): boolean {
			if (gesture.phase === 'idle') return false;
			reset();
			return true;
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

function enter(ctx: Context, event: ToolPointerEvent): void {
	const result = enterAt(ctx, event.world);
	if (result.kind === 'entered') {
		ctx.selection.select([result.id], 'replace', { source: 'canvas' });
		return;
	}
	if (result.kind === 'edit') ctx.emit('canvas/edit-request', result.id, result.editor);
}

function pressAt(ctx: Context, event: ToolPointerEvent): Press {
	const targetId = pickAt(ctx, event.world, event);
	if (targetId === undefined) return { kind: 'empty', shift: event.shiftKey };
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
