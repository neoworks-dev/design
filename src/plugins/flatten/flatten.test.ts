import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDocument, node, page, rectangle, text } from '../../lib/document/fixtures';
import type { DesignDocument, Paint, Stroke, TextNode } from '../../lib/document/types';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import type { FontEntry, FontRef } from '../../lib/fonts/resolve';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import { DrawHookRegistry, type DrawHooks } from '../../lib/renderer/draw/hooks';
import { loadTestFaces, paragraphOf, testResolver, textNode } from '../../lib/text/testing';
import canvaskit from '../canvaskit';
import textLayout from '../text-layout';
import variablesCore from '../variables-core';
import flatten from './index';

type Face = { face: FontEntry; bytes: ArrayBuffer };
let faces: Face[] = [];

beforeAll(async () => {
	faces = await loadTestFaces();
});

function solid(r: number, g: number, b: number): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r, g, b }
	};
}

function blueStroke(align: 'INSIDE' | 'CENTER' | 'OUTSIDE' = 'CENTER'): Stroke {
	return {
		paints: [solid(0, 0, 1)],
		weight: 6,
		align,
		cap: 'NONE',
		join: 'MITER',
		miterLimit: 4,
		dashPattern: []
	};
}

function scene(): DesignDocument {
	const label: TextNode = {
		...textNode(
			[paragraphOf('Flat text')],
			{ id: 'label', width: 160, height: 30 },
			{ fontSize: 20 }
		),
		defaultStyle: {
			...textNode([], {}).defaultStyle,
			fontName: { family: 'Geist', style: 'Regular' },
			fontSize: 20,
			fills: [solid(1, 0, 0)]
		}
	};
	return buildDocument([
		page(
			'Page',
			[
				rectangle({ id: 'solid', width: 80, height: 50, fills: [solid(1, 0, 0)], cornerRadius: 8 }),
				rectangle({
					id: 'framed',
					width: 80,
					height: 50,
					fills: [solid(1, 0, 0)],
					strokes: [blueStroke()]
				}),
				rectangle({ id: 'outlineOnly', width: 80, height: 50, strokes: [blueStroke('INSIDE')] }),
				node('ELLIPSE', { id: 'oval', width: 60, height: 40, fills: [solid(1, 0, 0)] }),
				node('FRAME', { id: 'frame', width: 100, height: 100 }),
				text(label)
			],
			{ id: 'p' }
		)
	]);
}

function fakes(): Plugin {
	const hooks = new DrawHookRegistry();
	return {
		name: 'fake-renderer-fonts',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('renderer', {
				registerDrawHooks: (entry: Partial<DrawHooks>) => hooks.register(entry)
			});
			ctx.provide('fonts', {
				resolve: testResolver,
				load: (ref: FontRef) => {
					const { face } = testResolver(ref);
					const found = faces.find((entry) => entry.face.style === face.style);
					return Promise.resolve({ ...testResolver(ref), bytes: found?.bytes });
				},
				attach: (sink: { registerFont(face: FontEntry, bytes: ArrayBuffer): void }) => {
					for (const entry of faces) sink.registerFont(entry.face, entry.bytes);
					return () => Promise.resolve();
				}
			});
		}
	} as Plugin;
}

function providers(): Plugin[] {
	const kit = {
		name: 'canvaskit',
		inject: [],
		async apply(ctx: Context): Promise<void> {
			await canvaskit.apply(ctx, { locateFile: nodeWasmLocator() });
		}
	};
	return [...editingProviders(scene()), fakes(), kit as Plugin, variablesCore, textLayout];
}

describePlugin('flatten', flatten, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('flatten.selection')).toBe(true);
		expect(ctx.commands.has('flatten.outline-stroke')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+e');
		expect(chords).toContain('ctrl+alt+o');
		expect(ctx.menus.has('context/canvas')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountFlatten(): Promise<Context> {
	mounted = await mountPlugin(flatten, { providers: providers() });
	return mounted.ctx;
}

function pageChildren(ctx: Context): string[] {
	return ctx.document.children('p').map((id) => id);
}

function vectors(ctx: Context): string[] {
	return pageChildren(ctx).filter((id) => ctx.document.get(id)?.type === 'VECTOR');
}

async function flattenIt(ctx: Context, ids: string[]): Promise<void> {
	ctx.selection.select(ids);
	await ctx.commands.run('flatten.selection');
	// the command is async (fonts load first): wait until the document has settled
	for (let attempt = 0; attempt < 50 && ctx.history.undoLabel === null; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe('Flatten (Ctrl+E)', () => {
	it('turns a shape into one vector with its fill, in place, as one undo step', async () => {
		const ctx = await mountFlatten();
		const before = pageChildren(ctx);
		await flattenIt(ctx, ['solid']);
		const [vectorId] = vectors(ctx);
		const vector = ctx.document.require(vectorId);
		if (vector.type !== 'VECTOR') throw new Error('not a vector');
		expect(ctx.document.has('solid')).toBe(false);
		expect(vector.fills).toHaveLength(1);
		expect(vector).toMatchObject({ width: 80, height: 50, name: expect.any(String) });
		expect(vector.network.regions?.length).toBe(1);
		expect(pageChildren(ctx).indexOf(vectorId)).toBe(before.indexOf('solid'));
		expect(ctx.selection.ids).toEqual([vectorId]);
		expect(ctx.history.undoLabel).toBe('Flatten');
		ctx.history.undo();
		expect(pageChildren(ctx)).toEqual(before);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('keeps strokes on the flattened vector and ignores frames and vectors', async () => {
		const ctx = await mountFlatten();
		await flattenIt(ctx, ['framed']);
		const [vectorId] = vectors(ctx);
		const vector = ctx.document.require(vectorId);
		expect('strokes' in vector && vector.strokes).toHaveLength(1);
		ctx.history.undo();
		ctx.selection.select(['frame']);
		await ctx.commands.run('flatten.selection');
		expect(vectors(ctx)).toEqual([]);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('flattens several selected shapes in one undo step', async () => {
		const ctx = await mountFlatten();
		await flattenIt(ctx, ['solid', 'oval']);
		expect(vectors(ctx)).toHaveLength(2);
		expect(ctx.selection.count).toBe(2);
		ctx.history.undo();
		expect(vectors(ctx)).toEqual([]);
		expect(ctx.document.has('oval')).toBe(true);
	});

	it('turns text into a vector of its glyph outlines with the text fill', async () => {
		const ctx = await mountFlatten();
		await flattenIt(ctx, ['label']);
		const [vectorId] = vectors(ctx);
		const vector = ctx.document.require(vectorId);
		if (vector.type !== 'VECTOR') throw new Error('not a vector');
		expect(ctx.document.has('label')).toBe(false);
		expect(vector.fills).toEqual([solid(1, 0, 0)]);
		expect(vector.network.regions?.[0].loops.length).toBeGreaterThan(5);
		const bounds = ctx.document.absoluteBounds(vectorId);
		expect(bounds.width).toBeGreaterThan(60);
		expect(bounds.width).toBeLessThan(170);
		expect(bounds.height).toBeGreaterThan(10);
		expect(bounds.height).toBeLessThan(35);
	});
});

describe('Outline stroke (Ctrl+Alt+O)', () => {
	it('replaces a node that has only a stroke by a vector filled with the stroke paint', async () => {
		const ctx = await mountFlatten();
		ctx.selection.select(['outlineOnly']);
		await ctx.commands.run('flatten.outline-stroke');
		const [vectorId] = vectors(ctx);
		const vector = ctx.document.require(vectorId);
		if (vector.type !== 'VECTOR') throw new Error('not a vector');
		expect(ctx.document.has('outlineOnly')).toBe(false);
		expect(vector.strokes).toEqual([]);
		expect(vector.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 0, g: 0, b: 1 } });
		expect(ctx.history.undoLabel).toBe('Outline stroke');
		ctx.history.undo();
		expect(ctx.document.has('outlineOnly')).toBe(true);
		expect(vectors(ctx)).toEqual([]);
	});

	it('keeps a filled node and puts the stroke vector right above it', async () => {
		const ctx = await mountFlatten();
		ctx.selection.select(['framed']);
		await ctx.commands.run('flatten.outline-stroke');
		const order = pageChildren(ctx);
		const [vectorId] = vectors(ctx);
		expect(order.indexOf(vectorId)).toBe(order.indexOf('framed') + 1);
		const kept = ctx.document.require('framed');
		expect('strokes' in kept && kept.strokes).toEqual([]);
		expect('fills' in kept && kept.fills).toHaveLength(1);
	});

	it('does nothing for a node without strokes', async () => {
		const ctx = await mountFlatten();
		ctx.selection.select(['solid']);
		await ctx.commands.run('flatten.outline-stroke');
		expect(vectors(ctx)).toEqual([]);
		expect(ctx.history.canUndo).toBe(false);
	});
});
