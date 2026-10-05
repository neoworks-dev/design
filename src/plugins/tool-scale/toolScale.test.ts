import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { planRescale, type Paint, type Stroke } from '../../lib/document';
import { buildDocument, frame, node, page, rectangle } from '../../lib/document/fixtures';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { selectionProviders } from '../../lib/selecting/fixtures/selectionFixture';
import type { ResizeGesture } from '../../lib/selecting/resizeGesture';
import toolScale from './index';

const PLAIN = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

const RED: Paint = {
	type: 'SOLID',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	color: { r: 1, g: 0, b: 0 }
};
const STROKE: Stroke = {
	paints: [RED],
	weight: 2,
	align: 'CENTER',
	cap: 'NONE',
	join: 'MITER',
	miterLimit: 4,
	dashPattern: [4, 2]
};

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame(
					{
						id: 'F',
						transform: at(100, 100),
						width: 200,
						height: 100,
						cornerRadius: 8,
						strokes: [STROKE]
					},
					[
						node('TEXT', { id: 'T', transform: at(20, 10), width: 80, height: 20 }),
						rectangle({
							id: 'K',
							transform: at(150, 50),
							width: 40,
							height: 40,
							constraints: { horizontal: 'MAX', vertical: 'MAX' }
						})
					]
				)
			],
			{ id: 'p' }
		)
	]);
}

describePlugin('tool-scale', toolScale, {
	providers: selectionProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('scale')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('k');
		const ids = ctx.regions.registry.list().map((entry) => entry.id);
		expect(ids).toContain('tool-scale/handles');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountScale(): Promise<{ ctx: Context; gesture: ResizeGesture }> {
	mounted = await mountPlugin(toolScale, { providers: selectionProviders(scene()) });
	const entry = mounted.ctx.regions.registry
		.list()
		.find((candidate) => candidate.id === 'tool-scale/handles');
	return { ctx: mounted.ctx, gesture: entry?.props?.gesture as ResizeGesture };
}

function fontSizeOf(ctx: Context, id: string): number {
	const text = ctx.document.require(id);
	if (text.type !== 'TEXT') throw new Error('not text');
	return text.defaultStyle.fontSize;
}

describe('scale gesture', () => {
	it('scales a frame, its text size, stroke, radius and children in one undo step', async () => {
		const { ctx, gesture } = await mountScale();
		ctx.selection.select(['F']);
		// Drag the south-east handle of F (300, 200) by +200 x: factor 2 (proportions kept).
		expect(gesture.begin('se', { x: 300, y: 200 })).toBe(true);
		gesture.update({ x: 400, y: 210 }, PLAIN);
		gesture.update({ x: 500, y: 200 }, PLAIN);
		gesture.commit();

		const scaled = ctx.document.require('F');
		expect(scaled).toMatchObject({ width: 400, height: 200, cornerRadius: 16 });
		expect(scaled.type === 'FRAME' && scaled.strokes[0].weight).toBe(4);
		expect(scaled.type === 'FRAME' && scaled.strokes[0].dashPattern).toEqual([8, 4]);
		expect(fontSizeOf(ctx, 'T')).toBe(32);
		expect(ctx.document.require('T')).toMatchObject({ width: 160, height: 40 });
		expect(ctx.document.absoluteBounds('T')).toMatchObject({ x: 140, y: 120 });
		// The constraint (MAX) is ignored: the child scales in place.
		expect(ctx.document.require('K')).toMatchObject({ width: 80, height: 80 });
		expect(ctx.document.absoluteBounds('K')).toMatchObject({ x: 400, y: 200 });

		expect(ctx.history.undoLabel).toBe('Scale');
		ctx.history.undo();
		expect(ctx.document.require('F')).toMatchObject({ width: 200, cornerRadius: 8 });
		expect(fontSizeOf(ctx, 'T')).toBe(16);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('keeps proportions on an edge handle and re-plans from the start state', async () => {
		const { ctx, gesture } = await mountScale();
		ctx.selection.select(['F']);
		gesture.begin('e', { x: 300, y: 150 });
		gesture.update({ x: 400, y: 150 }, PLAIN);
		gesture.update({ x: 350, y: 150 }, PLAIN);
		gesture.commit();
		expect(ctx.document.require('F')).toMatchObject({ width: 250, height: 125 });
		expect(fontSizeOf(ctx, 'T')).toBe(20);
	});

	it('cancel leaves no trace', async () => {
		const { ctx, gesture } = await mountScale();
		ctx.selection.select(['F']);
		gesture.begin('se', { x: 300, y: 200 });
		gesture.update({ x: 500, y: 300 }, PLAIN);
		gesture.cancel();
		expect(ctx.document.require('F')).toMatchObject({ width: 200, cornerRadius: 8 });
		expect(fontSizeOf(ctx, 'T')).toBe(16);
		expect(ctx.history.canUndo).toBe(false);
	});
});

describe('rescale', () => {
	it('scales a node about its own top left like the plugin API', async () => {
		const { ctx } = await mountScale();
		ctx.document.apply(planRescale(ctx.document.reader, 'F', 0.5), {
			origin: 'user',
			label: 'Rescale'
		});
		expect(ctx.document.require('F')).toMatchObject({ width: 100, height: 50, cornerRadius: 4 });
		expect(ctx.document.absoluteBounds('F')).toMatchObject({ x: 100, y: 100 });
		expect(fontSizeOf(ctx, 'T')).toBe(8);
	});
});
