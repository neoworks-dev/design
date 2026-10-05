import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { pointerEvent, selectionProviders } from '../../lib/selecting/fixtures/selectionFixture';
import type { PointerClaimant, PointerGrab } from '../../lib/tools/claim';
import rulersGuides from './index';

describePlugin('rulers-guides', rulersGuides, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('view.toggle-rulers')).toBe(true);
		expect(ctx.commands.has('view.toggle-guides')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('shift+r');
		expect(chords).toContain('ctrl+;');
		const overlays = ctx.overlay.registry.list().map((entry) => entry.id);
		expect(overlays).toContain('rulers-guides/guides');
		expect(overlays).toContain('rulers-guides/rulers');
		expect(ctx.canvasInput.claimants.has('rulers-guides/rulers')).toBe(true);
		expect(ctx.canvasInput.claimants.has('rulers-guides/guides')).toBe(true);
		expect(ctx.rulersGuides.rulersVisible).toBe(false);
		expect(ctx.rulersGuides.guidesVisible).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountGuides(): Promise<Context> {
	mounted = await mountPlugin(rulersGuides, { providers: selectionProviders() });
	return mounted.ctx;
}

function claimant(ctx: Context, id: string): PointerClaimant {
	const found = ctx.canvasInput.claimants.get(id);
	if (found === undefined) throw new Error(`no claimant ${id}`);
	return found;
}

function drag(ctx: Context, id: string, from: [number, number], to: [number, number]): void {
	const grab: PointerGrab | undefined = claimant(ctx, id).claim(pointerEvent(from[0], from[1]));
	if (grab === undefined) throw new Error('press was not claimed');
	grab.move(pointerEvent(to[0], to[1]));
	grab.up(pointerEvent(to[0], to[1]));
}

function pageGuides(ctx: Context): unknown {
	const page = ctx.document.require(ctx.document.currentPageId);
	return page.type === 'PAGE' ? page.guides : undefined;
}

function frameGuides(ctx: Context, id: string): unknown {
	const node = ctx.document.require(id);
	return 'guides' in node ? node.guides : undefined;
}

describe('rulers', () => {
	it('toggle on Shift+R and do not claim presses while hidden', async () => {
		const ctx = await mountGuides();
		const rulers = claimant(ctx, 'rulers-guides/rulers');
		expect(rulers.claim(pointerEvent(100, 5))).toBeUndefined();
		await ctx.commands.run('view.toggle-rulers');
		expect(ctx.rulersGuides.rulersVisible).toBe(true);
		expect(rulers.claim(pointerEvent(100, 5))).toBeDefined();
		expect(rulers.cursorAt?.(pointerEvent(100, 5))).toBe('row-resize');
		expect(rulers.cursorAt?.(pointerEvent(5, 100))).toBe('col-resize');
		expect(rulers.cursorAt?.(pointerEvent(100, 100))).toBeUndefined();
		await ctx.commands.run('view.toggle-rulers');
		expect(ctx.rulersGuides.rulersVisible).toBe(false);
	});

	it('draws without throwing, with a selection range', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		ctx.selection.select(['L']);
		const canvas = new Proxy(
			{},
			{
				get: () => () => undefined,
				set: () => true
			}
		) as CanvasRenderingContext2D;
		const frame = {
			ctx: canvas,
			camera: { x: 0, y: 0, scale: 1 },
			size: { width: 800, height: 600 },
			devicePixelRatio: 1,
			worldToScreen: (point: { x: number; y: number }) => point,
			worldRectToScreen: (rect: { x: number; y: number; width: number; height: number }) => rect
		};
		for (const entry of ctx.overlay.registry.list()) {
			if (entry.id.startsWith('rulers-guides/')) expect(() => entry.draw(frame)).not.toThrow();
		}
	});
});

describe('creating, moving and deleting guides', () => {
	it('dragging from the top ruler into empty canvas creates a page guide, undoable', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [1200, 5], [1200, 150]);
		expect(pageGuides(ctx)).toEqual([{ axis: 'Y', offset: 150 }]);
		expect(ctx.history.undoLabel).toBe('Create guide');
		ctx.history.undo();
		expect(pageGuides(ctx)).toEqual([]);
		ctx.history.redo();
		expect(pageGuides(ctx)).toEqual([{ axis: 'Y', offset: 150 }]);
	});

	it('a guide dropped inside a frame belongs to the frame, offset from its origin', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		// F is at 0,0 (400x400); F2 at 500,0 (300x300)
		drag(ctx, 'rulers-guides/rulers', [5, 100], [560, 100]);
		expect(frameGuides(ctx, 'F2')).toEqual([{ axis: 'X', offset: 60 }]);
		expect(pageGuides(ctx)).toEqual([]);
		ctx.history.undo();
		expect(frameGuides(ctx, 'F2')).toEqual([]);
	});

	it('releasing over the ruler discards a new guide without a history entry', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [1200, 5], [1200, 12]);
		expect(pageGuides(ctx)).toEqual([]);
		expect(ctx.history.canUndo).toBe(false);
		expect(ctx.rulersGuides.draft).toBeNull();
	});

	it('moves an existing guide and keeps its owner, one undo step', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [1200, 5], [1200, 150]);
		drag(ctx, 'rulers-guides/guides', [1200, 150], [1200, 210]);
		expect(pageGuides(ctx)).toEqual([{ axis: 'Y', offset: 210 }]);
		expect(ctx.history.undoLabel).toBe('Move guide');
		ctx.history.undo();
		expect(pageGuides(ctx)).toEqual([{ axis: 'Y', offset: 150 }]);
	});

	it('dragging an existing guide back onto its ruler deletes it, undoable', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [1200, 5], [1200, 150]);
		drag(ctx, 'rulers-guides/guides', [1200, 150], [1200, 8]);
		expect(pageGuides(ctx)).toEqual([]);
		expect(ctx.history.undoLabel).toBe('Delete guide');
		ctx.history.undo();
		expect(pageGuides(ctx)).toEqual([{ axis: 'Y', offset: 150 }]);
	});

	it('only grabs a guide while the rulers show, and tracks the draft while dragging', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [1200, 5], [1200, 150]);
		const guides = claimant(ctx, 'rulers-guides/guides');
		expect(guides.cursorAt?.(pointerEvent(1200, 152))).toBe('row-resize');
		expect(guides.cursorAt?.(pointerEvent(1200, 170))).toBeUndefined();
		const grab = guides.claim(pointerEvent(1200, 150));
		grab?.move(pointerEvent(1200, 180));
		expect(ctx.rulersGuides.draft).toMatchObject({ axis: 'Y', position: 180, overRuler: false });
		grab?.cancel();
		expect(ctx.rulersGuides.draft).toBeNull();
		await ctx.commands.run('view.toggle-rulers');
		expect(guides.claim(pointerEvent(1200, 150))).toBeUndefined();
	});

	it('Ctrl+; toggles guide visibility', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-guides');
		expect(ctx.rulersGuides.guidesVisible).toBe(false);
		await ctx.commands.run('view.toggle-guides');
		expect(ctx.rulersGuides.guidesVisible).toBe(true);
	});
});

describe('snapping to guides', () => {
	async function withGuide(): Promise<Context> {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [5, 1200], [1234, 1200]);
		return ctx;
	}

	it('snaps edges and centres within the threshold, and not beyond it', async () => {
		const ctx = await withGuide();
		expect(pageGuides(ctx)).toEqual([{ axis: 'X', offset: 1234 }]);
		expect(ctx.snapping.snap({ x: 1230, y: 1500, width: 20, height: 20 }).delta).toEqual({
			x: 4,
			y: 0
		});
		const centred = ctx.snapping.snap({ x: 1220, y: 1500, width: 30, height: 20 }).delta;
		expect(centred.x).toBe(-1);
		expect(ctx.snapping.snap({ x: 1100, y: 1500, width: 20, height: 20 }).delta).toEqual({
			x: 0,
			y: 0
		});
	});

	it('a resize snaps only the dragged edge to the guide', async () => {
		const ctx = await withGuide();
		const { delta } = ctx.snapping.snap(
			{ x: 1100, y: 1500, width: 131, height: 20 },
			{ lines: { x: ['max'] }, axes: 'x' }
		);
		expect(delta.x).toBe(3);
	});

	it('does not snap while guides are hidden or with Ctrl', async () => {
		const ctx = await withGuide();
		const moving = { x: 1230, y: 1500, width: 20, height: 20 };
		expect(ctx.snapping.snap(moving, { bypass: true }).delta.x).toBe(0);
		await ctx.commands.run('view.toggle-guides');
		expect(ctx.snapping.snap(moving).delta.x).toBe(0);
	});

	it('a frame guide snaps only objects alongside that frame', async () => {
		const ctx = await mountGuides();
		await ctx.commands.run('view.toggle-rulers');
		drag(ctx, 'rulers-guides/rulers', [5, 300], [330, 300]);
		expect(frameGuides(ctx, 'F')).toEqual([{ axis: 'X', offset: 330 }]);
		expect(ctx.snapping.snap({ x: 326, y: 100, width: 20, height: 20 }).delta.x).toBe(4);
		expect(ctx.snapping.snap({ x: 326, y: 1000, width: 20, height: 20 }).delta.x).toBe(0);
	});

	it('guide snapping follows the Snap to objects switch, pixel snap rounds the rest', async () => {
		const ctx = await withGuide();
		ctx.snapping.setEnabled(false);
		expect(ctx.snapping.snap({ x: 1230, y: 1500, width: 20, height: 20 }).delta.x).toBe(0);
		ctx.snapping.setEnabled(true);
		ctx.snapping.setPixelSnap(true);
		const { delta } = ctx.snapping.snap({ x: 1230.4, y: 1500.4, width: 20, height: 20 });
		expect(1230.4 + delta.x).toBeCloseTo(1234, 9);
		expect(1500.4 + delta.y).toBe(1500);
	});
});
