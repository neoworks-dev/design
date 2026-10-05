import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import {
	handleInteractionOf,
	pointerEvent,
	selectionProviders
} from '../../lib/selecting/fixtures/selectionFixture';
import { handleBox, handleWorldPoint } from '../../lib/selecting/handles';
import type { ResizeGesture } from '../../lib/selecting/resizeGesture';
import transformHandles from './index';

const NONE = { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false };

describePlugin('transform-handles', transformHandles, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		const ids = ctx.overlay.registry.list().map((entry) => entry.id);
		expect(ids).toContain('transform-handles/handles');
		expect(ctx.canvasInput.claimants.has('transform-handles/handles')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountHandles(): Promise<{ ctx: Context; gesture: ResizeGesture }> {
	mounted = await mountPlugin(transformHandles, { providers: selectionProviders() });
	const gesture = handleInteractionOf(mounted.ctx, 'transform-handles/handles').gesture;
	return { ctx: mounted.ctx, gesture };
}

function boundsOf(ctx: Context, id: string): number[] {
	const { x, y, width, height } = ctx.document.absoluteBounds(id);
	return [x, y, width, height];
}

describe('resize gesture', () => {
	it('resizes the selection by a handle, one undo step', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		expect(gesture.begin('se', { x: 1000, y: 100 })).toBe(true);
		gesture.update({ x: 1010, y: 105 }, NONE);
		gesture.update({ x: 1040, y: 130 }, NONE);
		gesture.commit();
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 140, 130]);
		expect(ctx.history.undoLabel).toBe('Resize');
		ctx.history.undo();
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 100, 100]);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('cancel leaves no trace', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		gesture.begin('se', { x: 1000, y: 100 });
		gesture.update({ x: 1040, y: 130 }, NONE);
		gesture.cancel();
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 100, 100]);
		expect(ctx.history.canUndo).toBe(false);
		expect(ctx.history.canRedo).toBe(false);
	});

	it('Esc on the window cancels a running resize', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		gesture.begin('e', { x: 1000, y: 50 });
		gesture.update({ x: 1040, y: 50 }, NONE);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(gesture.isActive).toBe(false);
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 100, 100]);
	});

	it('Shift keeps the aspect ratio, also when refreshed without a pointer move', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		gesture.begin('se', { x: 1000, y: 100 });
		gesture.update({ x: 1050, y: 100 }, NONE);
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 150, 100]);
		gesture.refresh({ ...NONE, shiftKey: true });
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 150, 150]);
		gesture.commit();
	});

	it('snaps the dragged edge to a neighbouring line unless Ctrl is held', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		// L's bottom edge dragged to y 202: the locked node's top edge at 200 is within the threshold.
		gesture.begin('s', { x: 950, y: 100 });
		gesture.update({ x: 950, y: 202 }, { ...NONE, ctrlKey: false });
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 100, 200]);
		gesture.update({ x: 950, y: 202 }, NONE);
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 100, 202]);
		gesture.cancel();
	});

	it('does nothing for a locked selection', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		ctx.document.apply(ctx.document.setProps('L', { locked: true }), {
			origin: 'user',
			label: 'Lock'
		});
		expect(gesture.begin('se', { x: 0, y: 0 })).toBe(false);
	});

	it('reports the size while it runs and clears it afterwards', async () => {
		const { ctx, gesture } = await mountHandles();
		ctx.selection.select(['L']);
		const feedback = handleInteractionOf(ctx, 'transform-handles/handles').feedback;
		gesture.begin('e', { x: 1000, y: 50 });
		gesture.update({ x: 1030, y: 50 }, NONE);
		expect(feedback.size).toEqual({ width: 130, height: 100 });
		gesture.commit();
		expect(feedback.size).toBeNull();
	});
});

describe('handle geometry', () => {
	it('places the handles on a single node and on a multi selection', async () => {
		const { ctx } = await mountHandles();
		const single = handleBox(ctx.document.reader, ['L']);
		expect(single && handleWorldPoint(single, 'se')).toEqual({ x: 1000, y: 100 });
		expect(single && handleWorldPoint(single, 'n')).toEqual({ x: 950, y: 0 });
		const several = handleBox(ctx.document.reader, ['L', 'T']);
		expect(several && handleWorldPoint(several, 'se')).toEqual({ x: 1000, y: 630 });
	});

	it('has no box for a locked selection', async () => {
		const { ctx } = await mountHandles();
		expect(handleBox(ctx.document.reader, ['locked'])).toBeUndefined();
	});
});

describe('pointer claim', () => {
	it('claims a press on a handle, resizes through the grab and shows the resize cursor', async () => {
		const { ctx } = await mountHandles();
		ctx.selection.select(['L']);
		const handles = handleInteractionOf(ctx, 'transform-handles/handles');
		expect(handles.cursorAt(pointerEvent(1000, 100))).toBe('nwse-resize');
		expect(handles.cursorAt(pointerEvent(950, 50))).toBeUndefined();
		const grab = handles.claim(pointerEvent(1000, 100));
		expect(grab).toBeDefined();
		grab?.move(pointerEvent(1040, 130, { ctrlKey: true }));
		grab?.up(pointerEvent(1040, 130, { ctrlKey: true }));
		expect(boundsOf(ctx, 'L')).toEqual([900, 0, 140, 130]);
		expect(ctx.history.undoLabel).toBe('Resize');
	});

	it('does not claim a press away from the handles', async () => {
		const { ctx } = await mountHandles();
		const handles = handleInteractionOf(ctx, 'transform-handles/handles');
		expect(handles.claim(pointerEvent(1000, 100))).toBeUndefined();
		ctx.selection.select(['L']);
		expect(handles.claim(pointerEvent(950, 50))).toBeUndefined();
	});
});
