import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, node, page, rectangle } from '../../lib/document/fixtures';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { selectionProviders } from '../../lib/selecting/fixtures/selectionFixture';
import type { ShapeHandleGesture } from '../../lib/selecting/shapeHandleGesture';
import { shapeHandles } from '../../lib/selecting/shapeHandles';
import shapeHandlesPlugin from './index';

const PLAIN = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				rectangle({ id: 'R', transform: at(0, 0), width: 200, height: 100, cornerRadius: 0 }),
				node('ELLIPSE', { id: 'E', transform: at(300, 0), width: 200, height: 200 }),
				node('STAR', { id: 'S', transform: at(600, 0), width: 200, height: 200, pointCount: 5 }),
				node('POLYGON', { id: 'P', transform: at(900, 0), width: 200, height: 200, pointCount: 3 }),
				rectangle({ id: 'tiny', transform: at(0, 400), width: 20, height: 20 })
			],
			{ id: 'p' }
		)
	]);
}

describePlugin('shape-handles', shapeHandlesPlugin, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		const ids = ctx.regions.registry.list().map((entry) => entry.id);
		expect(ids).toContain('shape-handles/overlay');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountHandles(): Promise<{ ctx: Context; gesture: ShapeHandleGesture }> {
	mounted = await mountPlugin(shapeHandlesPlugin, { providers: selectionProviders(scene()) });
	const entry = mounted.ctx.regions.registry
		.list()
		.find((candidate) => candidate.id === 'shape-handles/overlay');
	return { ctx: mounted.ctx, gesture: entry?.props?.gesture as ShapeHandleGesture };
}

function handleOf(ctx: Context, id: string, handleId: string): never {
	const handle = shapeHandles(ctx.document.require(id), 1).find((entry) => entry.id === handleId);
	if (handle === undefined) throw new Error(`no handle ${handleId}`);
	return handle as never;
}

describe('which handles show', () => {
	it('lists handles per type and hides them under the size threshold', async () => {
		const { ctx } = await mountHandles();
		const kinds = (id: string): string[] =>
			shapeHandles(ctx.document.require(id), 1).map((handle) => handle.kind);
		expect(kinds('R')).toEqual(['radius', 'radius', 'radius', 'radius']);
		expect(kinds('E')).toEqual(['arcStart', 'arcEnd', 'arcInner']);
		expect(kinds('S')).toEqual(['pointCount', 'starInner']);
		expect(kinds('P')).toEqual(['radius', 'pointCount']);
		expect(kinds('tiny')).toEqual([]);
		expect(shapeHandles(ctx.document.require('R'), 0.2)).toEqual([]);
	});
});

describe('shape handle drags', () => {
	it('drags the corner radius uniformly in one undo step', async () => {
		const { ctx, gesture } = await mountHandles();
		const handle = handleOf(ctx, 'R', 'radius-0');
		expect(gesture.begin('R', handle, { x: 14, y: 14 }, 1)).toBe(true);
		gesture.update({ x: 20, y: 20 }, PLAIN);
		gesture.update({ x: 30, y: 30 }, PLAIN);
		gesture.commit();
		expect(ctx.document.require('R')).toMatchObject({ cornerRadius: 30 });
		expect(ctx.history.undoLabel).toBe('Corner radius');
		ctx.history.undo();
		expect(ctx.document.require('R')).toMatchObject({ cornerRadius: 0 });
		expect(ctx.history.canUndo).toBe(false);
	});

	it('caps the radius at half the short side and Alt changes a single corner', async () => {
		const { ctx, gesture } = await mountHandles();
		gesture.begin('R', handleOf(ctx, 'R', 'radius-0'), { x: 14, y: 14 }, 1);
		gesture.update({ x: 90, y: 90 }, PLAIN);
		expect(ctx.document.require('R')).toMatchObject({ cornerRadius: 50 });
		gesture.update({ x: 20, y: 20 }, { ...PLAIN, altKey: true });
		expect(ctx.document.require('R')).toMatchObject({ cornerRadius: [20, 0, 0, 0] });
		gesture.commit();
	});

	it('changes the ellipse arc start, sweep end and inner radius', async () => {
		const { ctx, gesture } = await mountHandles();
		// Ellipse centre is (400, 100), radius 100.
		gesture.begin('E', handleOf(ctx, 'E', 'arc-start'), { x: 500, y: 100 }, 1);
		gesture.update({ x: 400, y: 200 }, PLAIN);
		gesture.commit();
		const start = ctx.document.require('E');
		expect(start.type === 'ELLIPSE' && start.arcData.startingAngle).toBeCloseTo(Math.PI / 2);

		gesture.begin('E', handleOf(ctx, 'E', 'arc-end'), { x: 500, y: 100 }, 1);
		gesture.update({ x: 300, y: 100 }, PLAIN);
		gesture.commit();
		const end = ctx.document.require('E');
		expect(end.type === 'ELLIPSE' && end.arcData.endingAngle).toBeCloseTo(Math.PI);

		gesture.begin('E', handleOf(ctx, 'E', 'arc-inner'), { x: 400, y: 120 }, 1);
		gesture.update({ x: 400, y: 150 }, PLAIN);
		gesture.commit();
		const inner = ctx.document.require('E');
		expect(inner.type === 'ELLIPSE' && inner.arcData.innerRadius).toBeCloseTo(0.5);
	});

	it('Shift snaps the arc angle to 15 degrees', async () => {
		const { ctx, gesture } = await mountHandles();
		gesture.begin('E', handleOf(ctx, 'E', 'arc-start'), { x: 500, y: 100 }, 1);
		gesture.update(
			{ x: 400 + 100 * Math.cos(0.3), y: 100 + 100 * Math.sin(0.3) },
			{ ...PLAIN, shiftKey: true }
		);
		gesture.commit();
		const ellipse = ctx.document.require('E');
		expect(ellipse.type === 'ELLIPSE' && ellipse.arcData.startingAngle).toBeCloseTo(Math.PI / 12);
	});

	it('changes the point count by dragging and the star inner ratio', async () => {
		const { ctx, gesture } = await mountHandles();
		gesture.begin('S', handleOf(ctx, 'S', 'points'), { x: 700, y: 0 }, 1);
		gesture.update({ x: 700 + 36, y: 0 }, PLAIN);
		gesture.commit();
		expect(ctx.document.require('S')).toMatchObject({ pointCount: 7 });

		gesture.begin('S', handleOf(ctx, 'S', 'inner'), { x: 700, y: 60 }, 1);
		gesture.update({ x: 700, y: 100 + 70 }, PLAIN);
		gesture.commit();
		const star = ctx.document.require('S');
		expect(star.type === 'STAR' && star.innerRadius).toBeCloseTo(0.7);
		gesture.begin('P', handleOf(ctx, 'P', 'points'), { x: 1000, y: 0 }, 1);
		gesture.update({ x: 1000 - 200, y: 0 }, PLAIN);
		gesture.commit();
		expect(ctx.document.require('P')).toMatchObject({ pointCount: 3 });
	});

	it('cancel leaves no trace', async () => {
		const { ctx, gesture } = await mountHandles();
		gesture.begin('R', handleOf(ctx, 'R', 'radius-0'), { x: 14, y: 14 }, 1);
		gesture.update({ x: 40, y: 40 }, PLAIN);
		gesture.cancel();
		expect(ctx.document.require('R')).toMatchObject({ cornerRadius: 0 });
		expect(ctx.history.canUndo).toBe(false);
	});
});
