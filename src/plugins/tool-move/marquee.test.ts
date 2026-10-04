import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import {
	clickAt,
	dragFromTo,
	pointerEvent,
	pressAt,
	selectionProviders
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

function selected(ctx: Context): string[] {
	return [...ctx.selection.ids];
}

describe('marquee selection', () => {
	it('selects a top-level frame only when the rectangle contains it entirely', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [-30, -30], [410, 410]);
		expect(selected(ctx)).toEqual(['F']);
	});

	it('marquee-selects the children of a frame it only partly covers', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [350, 350], [190, 190]);
		expect(selected(ctx)).toEqual(['NF']);
	});

	it('selects groups as units at the page scope', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [150, 150], [100, 30]);
		expect(selected(ctx)).toEqual(['G']);
	});

	it('Ctrl+drag selects the leaves and ignores the scope', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [-30, -30], [260, 260], { ctrlKey: true });
		expect(selected(ctx).sort()).toEqual(['inner', 'r1', 'r2']);
	});

	it('never selects locked or hidden nodes', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [880, -30], [1100, 700]);
		expect(selected(ctx).sort()).toEqual(['L', 'T']);
	});

	it('Shift toggles the marquee result against the previous selection', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 950, 50);
		dragFromTo(ctx, [-30, -30], [410, 410], { shiftKey: true });
		expect(selected(ctx)).toEqual(['L', 'F']);
		dragFromTo(ctx, [880, -30], [1100, 120], { shiftKey: true });
		expect(selected(ctx)).toEqual(['F']);
	});

	it('updates the selection live and exposes the rectangle', async () => {
		const ctx = await mountMove();
		pressAt(ctx, 880, -30);
		ctx.tools.pointerMove(pointerEvent(1100, 120));
		expect(selected(ctx)).toEqual(['L']);
		ctx.tools.pointerMove(pointerEvent(1100, -20));
		expect(selected(ctx)).toEqual([]);
	});

	it('Esc during the drag restores the previous selection', async () => {
		const ctx = await mountMove();
		clickAt(ctx, 950, 50);
		pressAt(ctx, -30, -30);
		ctx.tools.pointerMove(pointerEvent(410, 410));
		expect(selected(ctx)).toEqual(['F']);
		ctx.tools.cancel();
		expect(selected(ctx)).toEqual(['L']);
	});

	it('does not touch the document', async () => {
		const ctx = await mountMove();
		dragFromTo(ctx, [-30, -30], [410, 410]);
		expect(ctx.history.canUndo).toBe(false);
	});
});
