import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { createNode } from '../../lib/document';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { paragraphOf } from '../../lib/text/testing';
import type { FontRef } from '../../lib/fonts/resolve';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import hitTest from '../hit-test';
import spatial from '../spatial';
import toolText from './index';

interface EditRequest {
	id: string;
	point?: { x: number; y: number };
}

function fakes(requests: EditRequest[], installed: string[]): Plugin {
	return {
		name: 'fake-fonts-viewport-text-edit',
		inject: ['commands'],
		apply(ctx: Context): void {
			ctx.provide('viewport', { zoom: 1 });
			ctx.provide('fonts', {
				resolve: (ref: FontRef) => ({
					face: { ...ref, source: 'bundled' },
					missing: !installed.includes(ref.family)
				})
			});
			ctx.effect(
				() =>
					ctx.commands.register({
						id: 'text.edit',
						title: 'Edit text',
						run: (args) => {
							requests.push(args as EditRequest);
						}
					}),
				'fake text.edit'
			);
		}
	} as Plugin;
}

function providers(requests: EditRequest[] = [], installed: string[] = ['Inter']): Plugin[] {
	return [...editingProviders(), coreTools, spatial, hitTest, fakes(requests, installed)];
}

describePlugin('tool-text', toolText, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('text')).toBeDefined();
		expect(ctx.keymap.registry.listAll().map((binding) => binding.chord)).toContain('t');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountTool(installed?: string[]): Promise<{ ctx: Context; requests: EditRequest[] }> {
	const requests: EditRequest[] = [];
	mounted = await mountPlugin(toolText, { providers: providers(requests, installed) });
	return { ctx: mounted.ctx, requests };
}

function pointerEvent(x: number, y: number): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false
	};
}

function click(ctx: Context, x: number, y: number): void {
	ctx.tools.pointerDown(pointerEvent(x, y));
	ctx.tools.pointerUp(pointerEvent(x, y));
}

function drag(ctx: Context, from: [number, number], to: [number, number]): void {
	ctx.tools.pointerDown(pointerEvent(from[0], from[1]));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1]));
	ctx.tools.pointerUp(pointerEvent(to[0], to[1]));
}

function textNodes(ctx: Context): ReturnType<Context['document']['require']>[] {
	return ctx.document.query((node) => node.type === 'TEXT');
}

describe('creation', () => {
	it('a click on empty canvas creates an auto-width text, selects it and starts editing', async () => {
		const { ctx, requests } = await mountTool();
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		const [node] = textNodes(ctx);
		expect(node).toMatchObject({
			type: 'TEXT',
			name: 'Text 1',
			textAutoResize: 'WIDTH_AND_HEIGHT',
			parentId: 'p'
		});
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({ x: 700, y: 700 });
		expect(ctx.selection.ids).toEqual([node.id]);
		expect(requests).toEqual([{ id: node.id, point: undefined }]);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('a drag creates a fixed-width box that grows in height', async () => {
		const { ctx } = await mountTool();
		ctx.tools.activate('text');
		drag(ctx, [700, 700], [820, 740]);
		const [node] = textNodes(ctx);
		expect(node).toMatchObject({ type: 'TEXT', textAutoResize: 'HEIGHT', width: 120 });
	});

	it('creation is one undo step', async () => {
		const { ctx } = await mountTool();
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		expect(ctx.history.undoLabel).toBe('Create Text');
		ctx.history.undo();
		expect(textNodes(ctx)).toHaveLength(0);
	});

	it('names texts per type', async () => {
		const { ctx } = await mountTool();
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		ctx.tools.activate('text');
		click(ctx, 900, 700);
		expect(
			textNodes(ctx)
				.map((node) => node.name)
				.sort()
		).toEqual(['Text 1', 'Text 2']);
	});
});

describe('default style', () => {
	it('uses Inter when it is installed', async () => {
		const { ctx } = await mountTool(['Inter']);
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		const [node] = textNodes(ctx);
		expect(node.type === 'TEXT' && node.defaultStyle.fontName.family).toBe('Inter');
	});

	it('falls back to the bundled font so the new text is not flagged as missing', async () => {
		const { ctx } = await mountTool([]);
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		const [node] = textNodes(ctx);
		expect(node.type === 'TEXT' && node.defaultStyle.fontName.family).toBe('Geist');
	});
});

describe('clicking existing text', () => {
	it('edits it with the caret at the click and creates nothing', async () => {
		const { ctx, requests } = await mountTool();
		const existing = createNode('TEXT', {
			id: 'existing',
			parentId: 'p',
			index: 'z',
			width: 100,
			height: 20,
			transform: [
				[1, 0, 600],
				[0, 1, 600]
			]
		});
		ctx.document.apply(ctx.document.insertNode(existing), { origin: 'user', label: 'Add' });
		ctx.tools.activate('text');
		click(ctx, 620, 610);
		expect(textNodes(ctx)).toHaveLength(1);
		expect(ctx.selection.ids).toEqual(['existing']);
		expect(requests).toEqual([{ id: 'existing', point: { x: 620, y: 610 } }]);
		expect(ctx.tools.activeId()).toBe('move');
	});
});

describe('leaving the editor', () => {
	it('removes a text that is empty when editing stops and keeps one that has content', async () => {
		const { ctx } = await mountTool();
		ctx.tools.activate('text');
		click(ctx, 700, 700);
		const [empty] = textNodes(ctx);
		ctx.emit('text-edit/stopped', empty.id);
		expect(textNodes(ctx)).toHaveLength(0);
		expect(ctx.selection.ids).toEqual([]);

		ctx.tools.activate('text');
		click(ctx, 700, 700);
		const [filled] = textNodes(ctx);
		ctx.document.apply(ctx.document.setProps(filled.id, { paragraphs: [paragraphOf('hello')] }), {
			origin: 'user',
			label: 'Type'
		});
		ctx.emit('text-edit/stopped', filled.id);
		expect(textNodes(ctx)).toHaveLength(1);
	});
});
