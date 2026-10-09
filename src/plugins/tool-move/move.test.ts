import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import {
	pointerEvent,
	pressAt,
	releaseAt,
	selectionProviders,
	type PointerModifiers
} from '../../lib/selecting/fixtures/selectionFixture';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import toolMove from './index';

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountMove(): Promise<Context> {
	mounted = await mountPlugin(toolMove, { providers: selectionProviders() });
	return mounted.ctx;
}

// Presses plainly, moves (several moves, like a pointer does) and releases. `move` modifiers
// apply to the moves and the release only; Ctrl bypasses snapping for exact expectations.
function drag(
	ctx: Context,
	from: [number, number],
	to: [number, number],
	move: PointerModifiers = { ctrlKey: true },
	release = true
): void {
	pressAt(ctx, from[0], from[1]);
	const midway = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
	ctx.tools.pointerMove(pointerEvent(midway[0], midway[1], move));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1], move));
	if (release) releaseAt(ctx, to[0], to[1], move);
}

function boundsOf(ctx: Context, id: string): { x: number; y: number } {
	const { x, y } = ctx.document.absoluteBounds(id);
	return { x, y };
}

function parentOf(ctx: Context, id: string): string | null {
	return ctx.document.require(id).parentId;
}

describe('move gesture', () => {
	it('drags the node under the pointer by the pointer delta', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [1000, 80]);
		expect(boundsOf(ctx, 'L')).toEqual({ x: 950, y: 30 });
		expect([...ctx.selection.ids]).toEqual(['L']);
	});

	it('is one undo step and undo restores the position', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [1000, 80]);
		expect(ctx.history.undoLabel).toBe('Move');
		expect(ctx.history.undo()).toBe(true);
		expect(boundsOf(ctx, 'L')).toEqual({ x: 900, y: 0 });
		expect(ctx.history.canUndo).toBe(false);
	});

	it('Esc ends the drag where it is and clears the selection (as Figma does)', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [650, 150], {}, false);
		expect(parentOf(ctx, 'L')).toBe('F2');
		expect(ctx.tools.cancel()).toBe(true);
		expect(parentOf(ctx, 'L')).toBe('F2');
		expect(ctx.selection.count).toBe(0);
		expect(ctx.history.canUndo).toBe(true);
		ctx.tools.pointerMove(pointerEvent(100, 100));
		releaseAt(ctx, 100, 100);
		expect(parentOf(ctx, 'L')).toBe('F2');
	});

	it('Ctrl held during the drag keeps the node in its parent', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [650, 150], { ctrlKey: true });
		expect(parentOf(ctx, 'L')).toBe('p');
	});

	it('Shift keeps the larger component of the movement', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [1010, 70], { ctrlKey: true, shiftKey: true });
		expect(boundsOf(ctx, 'L')).toEqual({ x: 960, y: 0 });
		const second = await mountMove();
		drag(second, [950, 50], [960, 130], { ctrlKey: true, shiftKey: true });
		expect(boundsOf(second, 'L')).toEqual({ x: 900, y: 80 });
	});

	it('snaps to neighbouring edges unless Ctrl is held', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [952, 152], { shiftKey: false });
		expect(boundsOf(ctx, 'L')).toEqual({ x: 900, y: 100 });
		expect(ctx.snapping.guides).toEqual([]);
		ctx.history.undo();
		drag(ctx, [950, 50], [952, 152], { ctrlKey: true });
		expect(boundsOf(ctx, 'L')).toEqual({ x: 902, y: 102 });
	});

	it('reparents a node dropped over a frame, and out to the page again', async () => {
		const ctx = await mountMove();
		drag(ctx, [950, 50], [650, 150], {});
		expect(parentOf(ctx, 'L')).toBe('F2');
		expect(boundsOf(ctx, 'L')).toEqual({ x: 600, y: 100 });
		expect(ctx.history.undo()).toBe(true);
		expect(parentOf(ctx, 'L')).toBe('p');
		expect(boundsOf(ctx, 'L')).toEqual({ x: 900, y: 0 });
	});

	it('moves a child from one frame into another', async () => {
		const ctx = await mountMove();
		drag(ctx, [540, 40], [160, 140], {});
		expect(parentOf(ctx, 'kid')).toBe('F');
		expect(boundsOf(ctx, 'kid')).toEqual({ x: 140, y: 120 });
		drag(ctx, [160, 140], [1200, 500], {});
		expect(parentOf(ctx, 'kid')).toBe('p');
		expect(boundsOf(ctx, 'kid')).toEqual({ x: 1180, y: 480 });
	});

	it('a node inside a group stays in it while its centre is over the same frame', async () => {
		const ctx = await mountMove();
		ctx.selection.select(['r1']);
		pressAt(ctx, 30, 30, { ctrlKey: true });
		ctx.tools.pointerMove(pointerEvent(60, 100, { ctrlKey: true }));
		releaseAt(ctx, 60, 100, { ctrlKey: true });
		expect(parentOf(ctx, 'r1')).toBe('G');
	});

	it('Space pins the node to its container', async () => {
		const ctx = await mountMove();
		pressAt(ctx, 950, 50);
		ctx.tools.pointerMove(pointerEvent(940, 60, { ctrlKey: true }));
		ctx.tools.pointerMove(pointerEvent(945, 55, { ctrlKey: true }));
		const key = {
			key: ' ',
			code: 'Space',
			repeat: false,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			preventDefault: (): void => undefined
		};
		expect(ctx.tools.keyDown(key)).toBe(true);
		ctx.tools.pointerMove(pointerEvent(650, 150));
		expect(parentOf(ctx, 'L')).toBe('p');
		ctx.tools.keyUp(key);
		expect(parentOf(ctx, 'L')).toBe('F2');
		releaseAt(ctx, 650, 150);
		expect(parentOf(ctx, 'L')).toBe('F2');
	});

	it('Alt drags a duplicate and leaves the original', async () => {
		const ctx = await mountMove();
		const before = ctx.document.children('p').length;
		drag(ctx, [950, 50], [1000, 80], { ctrlKey: true, altKey: true });
		expect(ctx.document.children('p')).toHaveLength(before + 1);
		expect(boundsOf(ctx, 'L')).toEqual({ x: 900, y: 0 });
		const [copyId] = ctx.selection.ids;
		expect(copyId).not.toBe('L');
		expect(boundsOf(ctx, copyId)).toEqual({ x: 950, y: 30 });
		expect(ctx.history.undo()).toBe(true);
		expect(ctx.document.children('p')).toHaveLength(before);
	});

	it('moves every node of a multi selection together', async () => {
		const ctx = await mountMove();
		ctx.selection.select(['L', 'T']);
		drag(ctx, [950, 50], [960, 70]);
		expect(boundsOf(ctx, 'L')).toEqual({ x: 910, y: 20 });
		expect(boundsOf(ctx, 'T')).toEqual({ x: 910, y: 620 });
	});

	it('a click without movement changes nothing', async () => {
		const ctx = await mountMove();
		pressAt(ctx, 950, 50);
		releaseAt(ctx, 950, 50);
		expect(ctx.history.canUndo).toBe(false);
	});
});
