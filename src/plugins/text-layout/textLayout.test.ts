import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createNode } from '../../lib/document/defaults';
import type { TextNode } from '../../lib/document/types';
import type { FontEntry, FontRef } from '../../lib/fonts/resolve';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { loadCanvasKit, type CanvasKit } from '../../lib/renderer/canvaskit';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import { DrawHookRegistry, type DrawHooks } from '../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../lib/renderer/ownership';
import { loadTestFaces, paragraphOf, testResolver } from '../../lib/text/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import documentPlugin from '../document';
import variablesCore from '../variables-core';
import textLayout from './index';

let kit: CanvasKit;
const registry = new DrawHookRegistry();
const attached: { registerFont(face: FontEntry, bytes: ArrayBuffer): void }[] = [];
const loaded: FontRef[] = [];

beforeAll(async () => {
	kit = await loadCanvasKit(nodeWasmLocator());
});

function fakes(): Plugin {
	return {
		name: 'fake-renderer-fonts-canvaskit',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('renderer', {
				registerDrawHooks: (hooks: Partial<DrawHooks>) => registry.register(hooks)
			});
			ctx.provide('canvaskit', { kit, tracker: new SkiaTracker() });
			ctx.provide('fonts', {
				resolve: testResolver,
				load: (ref: FontRef) => {
					loaded.push(ref);
					return Promise.resolve();
				},
				attach: (sink: { registerFont(face: FontEntry, bytes: ArrayBuffer): void }) => {
					attached.push(sink);
					return () => Promise.resolve();
				}
			});
		}
	} as Plugin;
}

const providers = [fakes(), coreContextKeys, coreCommands, documentPlugin, variablesCore];

describePlugin('text-layout', textLayout, {
	providers,
	contributes: () => {
		expect(registry.registrations).toBe(1);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

function textNodeOf(id: string, props: Partial<TextNode>): TextNode {
	const base = createNode('TEXT', { id, ...props });
	return {
		...base,
		defaultStyle: { ...base.defaultStyle, fontName: { family: 'Geist', style: 'Regular' } },
		...props
	};
}

async function mountWithText(props: Partial<TextNode>): Promise<Context> {
	attached.length = 0;
	mounted = await mountPlugin(textLayout, { providers });
	for (const sink of attached) {
		for (const { face, bytes } of await loadTestFaces()) sink.registerFont(face, bytes);
	}
	const { ctx } = mounted;
	const node = textNodeOf('t1', { parentId: ctx.document.currentPageId, index: 'a0', ...props });
	ctx.document.apply(ctx.document.insertNode(node), { origin: 'user', label: 'Add text' });
	return ctx;
}

describe('auto resize in the edit transaction', () => {
	it('fits width and height of an auto-width text when its content changes, one undo step', async () => {
		const ctx = await mountWithText({ paragraphs: [paragraphOf('x')] });
		const before = ctx.document.get('t1');
		if (!before || before.type !== 'TEXT') throw new Error('missing');

		const transaction = ctx.document.apply(
			ctx.document.setProps('t1', { paragraphs: [paragraphOf('A much longer line of text')] }),
			{ origin: 'user', label: 'Edit text' }
		);
		const after = ctx.document.get('t1');
		if (!after || after.type !== 'TEXT') throw new Error('missing');
		expect(after.width).toBeGreaterThan(before.width);
		expect(transaction.changes.length).toBeGreaterThan(1);

		ctx.document.apply(transaction.undo, { origin: 'user', label: 'Undo', replay: 'undo' });
		expect(ctx.document.get('t1')).toMatchObject({ width: before.width, height: before.height });
	});

	it('auto height keeps the width and grows the height when the text wraps', async () => {
		const ctx = await mountWithText({
			paragraphs: [paragraphOf('short')],
			textAutoResize: 'HEIGHT',
			width: 60
		});
		ctx.document.apply(
			ctx.document.setProps('t1', {
				paragraphs: [paragraphOf('This sentence needs several lines at sixty pixels')]
			}),
			{ origin: 'user', label: 'Edit text' }
		);
		const node = ctx.document.get('t1');
		if (!node || node.type !== 'TEXT') throw new Error('missing');
		expect(node.width).toBe(60);
		expect(node.height).toBeGreaterThan(60);
	});

	it('measures the text at a given width without touching the node or its cache', async () => {
		const ctx = await mountWithText({
			paragraphs: [paragraphOf('A sentence that wraps somewhere')]
		});
		const before = ctx.textLayout.measure('t1');
		const narrow = ctx.textLayout.measureAt('t1', 60);
		const natural = ctx.textLayout.measureAt('t1', null);
		expect(narrow.width).toBe(60);
		expect(narrow.lineCount).toBeGreaterThan(1);
		expect(natural.lineCount).toBe(1);
		expect(natural.width).toBeCloseTo(before.width, 1);
		expect(ctx.textLayout.engine.cachedNodeCount).toBe(1);
		expect(ctx.document.get('t1')).toMatchObject({ width: before.width });
	});

	it('fixed size is left alone', async () => {
		const ctx = await mountWithText({
			paragraphs: [paragraphOf('x')],
			textAutoResize: 'NONE',
			width: 50,
			height: 50
		});
		ctx.document.apply(ctx.document.setProps('t1', { paragraphs: [paragraphOf('x'.repeat(40))] }), {
			origin: 'user',
			label: 'Edit text'
		});
		expect(ctx.document.get('t1')).toMatchObject({ width: 50, height: 50 });
	});

	it('exposes measure, caret and hit testing by node id and asks the fonts service for faces', async () => {
		const ctx = await mountWithText({ paragraphs: [paragraphOf('Hello')] });
		const measure = ctx.textLayout.measure('t1');
		expect(measure.lineCount).toBe(1);
		const caret = ctx.textLayout.caretRect('t1', { paragraph: 0, offset: 5 });
		expect(caret.x).toBeGreaterThan(10);
		expect(ctx.textLayout.offsetAtPoint('t1', { x: caret.x + 1, y: 4 })).toEqual({
			paragraph: 0,
			offset: 5
		});
		expect(ctx.textLayout.missingFonts('t1')).toEqual([]);
	});
});
