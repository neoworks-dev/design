import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignDocument } from '../../lib/document';
import { buildDocument, frame, page } from '../../lib/document/fixtures';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import {
	dragFromTo,
	pointerEvent,
	selectionProviders
} from '../../lib/selecting/fixtures/selectionFixture';
import type { PointerClaimant } from '../../lib/tools/claim';
import autolayout from '../autolayout';
import { fakeTextLayout, rect } from '../autolayout/fixtures/autolayoutFixture';
import toolMove from '../tool-move';
import variablesCore from '../variables-core';
import autolayoutHandles from './index';
import { HandlesFeedback } from './feedback.svelte';
import { ReorderDrag } from './reorderDrag';

// AF is a hugging horizontal stack at 100,100: padding 10, gap 10, three 40x40 boxes laid out
// already (a at 110, b at 160, c at 210 on the page). `free` is an ordinary frame next to it.
function scene(): DesignDocument {
	const stack = {
		id: 'AF',
		name: 'AF',
		transform: at(100, 100),
		width: 160,
		height: 60,
		layoutMode: 'HORIZONTAL',
		itemSpacing: 10,
		paddingTop: 10,
		paddingRight: 10,
		paddingBottom: 10,
		paddingLeft: 10,
		layoutSizingHorizontal: 'HUG',
		layoutSizingVertical: 'HUG'
	} as const;
	return buildDocument([
		page(
			'Page',
			[
				frame(stack, [
					rect('a', 40, 40, 10, 10),
					rect('b', 40, 40, 60, 10),
					rect('c', 40, 40, 110, 10)
				]),
				frame({ id: 'free', name: 'free', transform: at(500, 100), width: 200, height: 200 }, [
					rect('f1', 30, 30, 10, 10)
				])
			],
			{ id: 'p' }
		)
	]);
}

function providers(): Plugin[] {
	return [...selectionProviders(scene()), variablesCore, fakeTextLayout(), autolayout, toolMove];
}

describePlugin('autolayout-handles', autolayoutHandles, {
	providers: providers(),
	contributes: ({ ctx }) => {
		const ids = ctx.overlay.registry.list().map((entry) => entry.id);
		expect(ids).toContain('autolayout-handles/handles');
		expect(ids).toContain('autolayout-handles/reorder');
		expect(ctx.canvasInput.claimants.has('autolayout-handles/handles')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(autolayoutHandles, { providers: providers() });
	return mounted.ctx;
}

function claimant(ctx: Context): PointerClaimant {
	const found = ctx.canvasInput.claimants.get('autolayout-handles/handles');
	if (found === undefined) throw new Error('no claimant');
	return found;
}

function x(ctx: Context, id: string): number {
	const node = ctx.document.require(id);
	if (node.type === 'PAGE') throw new Error('page');
	return node.transform[0][2];
}

function order(ctx: Context): string[] {
	return [...ctx.document.children('AF')];
}

describe('padding and gap handles', () => {
	it('claim nothing unless one auto layout frame is selected', async () => {
		const ctx = await open();
		expect(claimant(ctx).claim(pointerEvent(105, 130))).toBeUndefined();
		ctx.selection.select(['free']);
		expect(claimant(ctx).claim(pointerEvent(105, 130))).toBeUndefined();
		ctx.selection.select(['AF']);
		expect(claimant(ctx).claim(pointerEvent(105, 130))).toBeDefined();
		expect(claimant(ctx).cursorAt?.(pointerEvent(105, 130))).toBe('ew-resize');
		expect(claimant(ctx).cursorAt?.(pointerEvent(180, 90))).toBeUndefined();
	});

	it('changes one padding side by dragging inward, in one undo step', async () => {
		const ctx = await open();
		ctx.selection.select(['AF']);
		const grab = claimant(ctx).claim(pointerEvent(105, 130));
		grab?.move(pointerEvent(108, 130));
		grab?.move(pointerEvent(112, 130));
		grab?.up(pointerEvent(112, 130));
		expect(ctx.document.require('AF')).toMatchObject({
			paddingLeft: 17,
			paddingRight: 10,
			width: 167
		});
		expect(x(ctx, 'a')).toBe(17);
		expect(ctx.history.entries).toHaveLength(1);
		ctx.history.undo();
		expect(ctx.document.require('AF')).toMatchObject({ paddingLeft: 10, width: 160 });
		expect(x(ctx, 'a')).toBe(10);
	});

	it('mirrors the opposite side with Alt and sets all sides with Shift', async () => {
		const ctx = await open();
		ctx.selection.select(['AF']);
		const mirrored = claimant(ctx).claim(pointerEvent(105, 130));
		mirrored?.move(pointerEvent(110, 130, { altKey: true }));
		mirrored?.up(pointerEvent(110, 130, { altKey: true }));
		expect(ctx.document.require('AF')).toMatchObject({ paddingLeft: 15, paddingRight: 15 });
		const all = claimant(ctx).claim(pointerEvent(105, 130));
		all?.move(pointerEvent(100, 130, { shiftKey: true }));
		all?.up(pointerEvent(100, 130, { shiftKey: true }));
		expect(ctx.document.require('AF')).toMatchObject({
			paddingLeft: 10,
			paddingRight: 10,
			paddingTop: 10,
			paddingBottom: 10
		});
	});

	it('drags the item spacing from a gap handle', async () => {
		const ctx = await open();
		ctx.selection.select(['AF']);
		const grab = claimant(ctx).claim(pointerEvent(155, 130));
		grab?.move(pointerEvent(160, 130));
		grab?.up(pointerEvent(160, 130));
		expect(ctx.document.require('AF')).toMatchObject({ itemSpacing: 15 });
		expect(x(ctx, 'b')).toBe(65);
		expect(x(ctx, 'c')).toBe(120);
		expect(ctx.history.entries).toHaveLength(1);
	});

	it('cancel leaves no trace', async () => {
		const ctx = await open();
		ctx.selection.select(['AF']);
		const grab = claimant(ctx).claim(pointerEvent(155, 130));
		grab?.move(pointerEvent(175, 130));
		expect(ctx.document.require('AF')).toMatchObject({ itemSpacing: 30 });
		grab?.cancel();
		expect(ctx.document.require('AF')).toMatchObject({ itemSpacing: 10, width: 160 });
		expect(ctx.history.canUndo).toBe(false);
	});
});

describe('reorder drag', () => {
	it('moves a child to the slot under the pointer, one undo step', async () => {
		const ctx = await open();
		dragFromTo(ctx, [130, 130], [260, 130]);
		expect(order(ctx)).toEqual(['b', 'c', 'a']);
		expect(x(ctx, 'a')).toBe(110);
		expect(x(ctx, 'b')).toBe(10);
		expect(ctx.history.undoLabel).toBe('Reorder');
		ctx.history.undo();
		expect(order(ctx)).toEqual(['a', 'b', 'c']);
		expect(x(ctx, 'a')).toBe(10);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('drops between two children', async () => {
		const ctx = await open();
		dragFromTo(ctx, [130, 130], [205, 130]);
		expect(order(ctx)).toEqual(['b', 'a', 'c']);
		dragFromTo(ctx, [180, 130], [105, 130]);
		expect(order(ctx)).toEqual(['a', 'b', 'c']);
	});

	it('records nothing when the child is dropped where it was', async () => {
		const ctx = await open();
		dragFromTo(ctx, [130, 130], [140, 135]);
		expect(order(ctx)).toEqual(['a', 'b', 'c']);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('leaves the document alone while dragging and reports the slot and ghosts', async () => {
		const ctx = await open();
		const feedback = new HandlesFeedback();
		const drag = ReorderDrag.begin(ctx, feedback, {
			ids: ['a'],
			startWorld: { x: 130, y: 130 },
			modifiers: pointerEvent(0, 0)
		});
		expect(drag).toBeDefined();
		drag?.update({ x: 205, y: 130 }, pointerEvent(205, 130));
		expect(order(ctx)).toEqual(['a', 'b', 'c']);
		expect(feedback.reorder?.targetId).toBe('AF');
		expect(feedback.reorder?.line).toEqual({ from: { x: 205, y: 110 }, to: { x: 205, y: 150 } });
		expect(feedback.reorder?.ghosts).toEqual([{ x: 185, y: 110, width: 40, height: 40 }]);
		drag?.cancel();
		expect(feedback.reorder).toBeNull();
		expect(ctx.history.canUndo).toBe(false);
	});

	it('takes a child out of auto layout when dropped on another frame, keeping its place', async () => {
		const ctx = await open();
		dragFromTo(ctx, [130, 130], [610, 210]);
		const moved = ctx.document.require('a');
		expect(moved.parentId).toBe('free');
		expect(ctx.document.absoluteBounds('a')).toMatchObject({ x: 590, y: 190 });
		expect(order(ctx)).toEqual(['b', 'c']);
		expect(ctx.document.require('AF')).toMatchObject({ width: 110 });
	});

	it('Space keeps the drop inside the frame it started in', async () => {
		const ctx = await open();
		const feedback = new HandlesFeedback();
		const drag = ReorderDrag.begin(ctx, feedback, {
			ids: ['a'],
			startWorld: { x: 130, y: 130 },
			modifiers: pointerEvent(0, 0)
		});
		drag?.setPinned(true);
		drag?.update({ x: 610, y: 210 }, pointerEvent(610, 210));
		expect(feedback.reorder?.targetId).toBe('AF');
		drag?.commit();
		expect(order(ctx)).toEqual(['b', 'c', 'a']);
	});

	it('declines drags it does not understand', async () => {
		const ctx = await open();
		const feedback = new HandlesFeedback();
		const begin = (ids: string[], altKey = false): ReturnType<typeof ReorderDrag.begin> =>
			ReorderDrag.begin(ctx, feedback, {
				ids,
				startWorld: { x: 0, y: 0 },
				modifiers: pointerEvent(0, 0, { altKey })
			});
		expect(begin(['f1'])).toBeUndefined();
		expect(begin(['AF'])).toBeUndefined();
		expect(begin(['a', 'f1'])).toBeUndefined();
		expect(begin(['a'], true)).toBeUndefined();
		expect(begin(['a', 'b'])).toBeDefined();
	});

	it('reorders several children at once', async () => {
		const ctx = await open();
		ctx.selection.select(['a', 'b']);
		const drag = ReorderDrag.begin(ctx, new HandlesFeedback(), {
			ids: ['a', 'b'],
			startWorld: { x: 130, y: 130 },
			modifiers: pointerEvent(0, 0)
		});
		drag?.update({ x: 255, y: 130 }, pointerEvent(255, 130));
		drag?.commit();
		expect(order(ctx)).toEqual(['c', 'a', 'b']);
	});
});
