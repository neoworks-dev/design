import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolKeyEvent, ToolPointerEvent } from '../../lib/tools/protocol';
import { parseNode } from '../../lib/document';
import coreTools from '../core-tools';
import overlay from '../overlay';
import toolPen from './index';

const fakeViewport = {
	name: 'fake-viewport',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('viewport', { camera: { x: 0, y: 0, scale: 1 }, zoom: 1 })
} as Plugin;

function providers(): Plugin[] {
	return [...editingProviders(), coreTools, fakeViewport, overlay];
}

describePlugin('tool-pen', toolPen, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('pen')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('p');
		expect(ctx.overlay.contributions().map((entry) => entry.id)).toContain('tool-pen/draft');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountPen(): Promise<Context> {
	mounted = await mountPlugin(toolPen, { providers: providers() });
	mounted.ctx.tools.activate('pen');
	return mounted.ctx;
}

function pointer(x: number, y: number, shiftKey = false): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey,
		altKey: false,
		ctrlKey: false,
		metaKey: false
	};
}

function key(name: string, ctrlKey = false): ToolKeyEvent {
	return {
		key: name,
		code: name,
		repeat: false,
		shiftKey: false,
		altKey: false,
		ctrlKey,
		metaKey: false,
		preventDefault: () => undefined
	};
}

function click(ctx: Context, x: number, y: number): void {
	ctx.tools.pointerDown(pointer(x, y));
	ctx.tools.pointerUp(pointer(x, y));
}

function vectors(ctx: Context): ReturnType<Context['document']['query']> {
	return ctx.document.query((node) => node.type === 'VECTOR');
}

describe('pen tool', () => {
	it('Enter ends an open path as one VECTOR node and one undo step', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		click(ctx, 760, 700);
		click(ctx, 760, 760);
		expect(vectors(ctx)).toHaveLength(0);
		ctx.tools.keyDown(key('Enter'));
		const [node] = vectors(ctx);
		expect(node.type === 'VECTOR' && node.network.segments).toHaveLength(2);
		expect(node.type === 'VECTOR' && node.network.regions).toBeUndefined();
		expect(parseNode(node).ok).toBe(true);
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({ x: 700, y: 700, width: 60 });
		expect(ctx.selection.ids).toEqual([node.id]);
		expect(ctx.tools.activeId()).toBe('pen');
		ctx.history.undo();
		expect(vectors(ctx)).toHaveLength(0);
	});

	it('Esc commits an open path, a second Esc leaves the tool', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		click(ctx, 760, 700);
		expect(ctx.tools.cancel()).toBe(true);
		expect(vectors(ctx)).toHaveLength(1);
		expect(ctx.tools.activeId()).toBe('pen');
		expect(ctx.tools.cancel()).toBe(true);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('clicking the first point closes the path into a region', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		click(ctx, 760, 700);
		click(ctx, 760, 760);
		click(ctx, 701, 701);
		const [node] = vectors(ctx);
		expect(node.type === 'VECTOR' && node.network.regions).toHaveLength(1);
		expect(parseNode(node).ok).toBe(true);
	});

	it('click-drag creates smooth points', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		ctx.tools.pointerDown(pointer(800, 700));
		ctx.tools.pointerMove(pointer(830, 730));
		ctx.tools.pointerUp(pointer(830, 730));
		ctx.tools.keyDown(key('Enter'));
		const [node] = vectors(ctx);
		const segment = node.type === 'VECTOR' ? node.network.segments[0] : undefined;
		expect(segment?.tangentEnd).toEqual({ x: -30, y: -30 });
	});

	it('Ctrl+Z removes the last point while building; nothing is committed until the end', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		click(ctx, 760, 700);
		click(ctx, 760, 760);
		expect(ctx.tools.keyDown(key('z', true))).toBe(true);
		ctx.tools.keyDown(key('Enter'));
		const [node] = vectors(ctx);
		expect(node.type === 'VECTOR' && node.network.vertices).toHaveLength(2);
	});

	it('clicking a vertex of the selected vector continues and branches it', async () => {
		const ctx = await mountPen();
		click(ctx, 700, 700);
		click(ctx, 760, 700);
		ctx.tools.keyDown(key('Enter'));
		const [created] = vectors(ctx);
		click(ctx, 760, 700);
		click(ctx, 760, 760);
		ctx.tools.keyDown(key('Enter'));
		expect(vectors(ctx)).toHaveLength(1);
		const node = ctx.document.require(created.id);
		expect(node.type === 'VECTOR' && node.network.segments).toHaveLength(2);
		expect(ctx.document.absoluteBounds(created.id)).toMatchObject({ x: 700, y: 700, height: 60 });
	});
});
