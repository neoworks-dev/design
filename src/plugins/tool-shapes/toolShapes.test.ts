import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import toolShapes from './index';

function providers(): Plugin[] {
	return [...editingProviders(), coreTools];
}

describePlugin('tool-shapes', toolShapes, {
	providers: providers(),
	contributes: ({ ctx }) => {
		for (const id of ['rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'star']) {
			expect(ctx.tools.get(id)).toBeDefined();
		}
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('r');
		expect(chords).toContain('o');
		expect(chords).toContain('l');
		expect(chords).toContain('shift+l');
		expect(ctx.tools.toolbarTools().map((entry) => entry.id)).toEqual([
			'rectangle',
			'ellipse',
			'line'
		]);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountShapes(): Promise<Context> {
	mounted = await mountPlugin(toolShapes, { providers: providers() });
	return mounted.ctx;
}

interface Modifiers {
	altKey?: boolean;
	shiftKey?: boolean;
}

function pointerEvent(x: number, y: number, modifiers: Modifiers = {}): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey: modifiers.shiftKey === true,
		altKey: modifiers.altKey === true,
		ctrlKey: false,
		metaKey: false
	};
}

function drag(
	ctx: Context,
	from: [number, number],
	to: [number, number],
	modifiers: Modifiers = {}
): void {
	ctx.tools.pointerDown(pointerEvent(from[0], from[1], modifiers));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1], modifiers));
	ctx.tools.pointerUp(pointerEvent(to[0], to[1], modifiers));
}

function click(ctx: Context, at: [number, number]): void {
	ctx.tools.pointerDown(pointerEvent(at[0], at[1]));
	ctx.tools.pointerUp(pointerEvent(at[0], at[1]));
}

function created(ctx: Context): { id: string; node: ReturnType<Context['document']['require']> } {
	const id = ctx.selection.ids[0];
	return { id, node: ctx.document.require(id) };
}

describe('rectangle and ellipse', () => {
	it('drag creates a named, filled shape on the page, selects it and reverts to Move', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('rectangle');
		drag(ctx, [700, 700], [760, 740]);
		const { node } = created(ctx);
		expect(node).toMatchObject({
			type: 'RECTANGLE',
			name: 'Rectangle 1',
			width: 60,
			height: 40,
			parentId: 'p'
		});
		expect(node.type === 'RECTANGLE' && node.fills).toHaveLength(1);
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({ x: 700, y: 700 });
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('numbers names per type', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('rectangle');
		drag(ctx, [700, 700], [720, 720]);
		ctx.tools.activate('rectangle');
		drag(ctx, [700, 700], [720, 720]);
		ctx.tools.activate('ellipse');
		drag(ctx, [700, 700], [720, 720]);
		const names = ctx.document.query((node) => node.type !== 'PAGE').map((node) => node.name);
		expect(names).toContain('Rectangle 2');
		expect(names).toContain('Ellipse 1');
	});

	it('Alt draws from the centre and Shift makes a square', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('rectangle');
		drag(ctx, [800, 800], [820, 830], { altKey: true });
		expect(ctx.document.absoluteBounds(created(ctx).id)).toEqual({
			x: 780,
			y: 770,
			width: 40,
			height: 60
		});
		ctx.tools.activate('ellipse');
		drag(ctx, [800, 800], [820, 850], { shiftKey: true });
		const ellipse = created(ctx).node;
		expect(ellipse).toMatchObject({ type: 'ELLIPSE', width: 50, height: 50 });
	});

	it('a click creates a default 100 x 100 shape', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('ellipse');
		click(ctx, [900, 900]);
		expect(created(ctx).node).toMatchObject({ type: 'ELLIPSE', width: 100, height: 100 });
	});

	it('creation is one undo step, redo restores it', async () => {
		const ctx = await mountShapes();
		const before = ctx.document.query((node) => node.type !== 'PAGE').length;
		ctx.tools.activate('rectangle');
		drag(ctx, [700, 700], [760, 740]);
		const id = created(ctx).id;
		expect(ctx.document.has(id)).toBe(true);
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
		expect(ctx.document.query((node) => node.type !== 'PAGE')).toHaveLength(before);
		ctx.history.redo();
		expect(ctx.document.has(id)).toBe(true);
	});

	it('nests into the frame under the pointer, positioned relative to it', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('rectangle');
		drag(ctx, [150, 160], [200, 200]);
		const { node } = created(ctx);
		expect(node.parentId).toBe('f');
		if (node.type !== 'RECTANGLE') throw new Error('expected a rectangle');
		expect(node.transform[0][2]).toBe(50);
		expect(node.transform[1][2]).toBe(60);
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({ x: 150, y: 160 });
	});

	it('Escape during a drag cancels without creating anything', async () => {
		const ctx = await mountShapes();
		const before = ctx.document.revision;
		ctx.tools.activate('rectangle');
		ctx.tools.pointerDown(pointerEvent(700, 700));
		ctx.tools.pointerMove(pointerEvent(760, 740));
		expect(ctx.tools.cancel()).toBe(true);
		ctx.tools.pointerUp(pointerEvent(760, 740));
		expect(ctx.document.revision).toBe(before);
	});

	it('a locked tool stays active after creating', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('rectangle', { lock: true });
		click(ctx, [900, 900]);
		expect(ctx.tools.activeId()).toBe('rectangle');
	});
});

describe('line and arrow', () => {
	it('Shift snaps the line to 15 degree steps', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('line');
		drag(ctx, [700, 700], [800, 730], { shiftKey: true });
		const { node } = created(ctx);
		if (node.type !== 'LINE') throw new Error('expected a line');
		expect(node.name).toBe('Line 1');
		expect(node.height).toBe(0);
		expect(node.width).toBeCloseTo(Math.hypot(100, 30), 6);
		const angle = Math.atan2(node.transform[1][0], node.transform[0][0]);
		expect((angle * 180) / Math.PI).toBeCloseTo(15, 6);
		expect(node.fills).toHaveLength(0);
		expect(node.strokes[0].cap).toBe('NONE');
	});

	it('a click creates a 100 long line', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('line');
		click(ctx, [700, 700]);
		expect(created(ctx).node).toMatchObject({ type: 'LINE', width: 100, height: 0 });
	});

	it('the arrow is a line with an arrow cap, via Shift+L', async () => {
		const ctx = await mountShapes();
		ctx.keymap.handleKeydown({
			key: 'L',
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: true,
			repeat: false
		});
		expect(ctx.tools.activeId()).toBe('arrow');
		drag(ctx, [700, 700], [800, 700]);
		const { node } = created(ctx);
		if (node.type !== 'LINE') throw new Error('expected a line');
		expect(node.name).toBe('Arrow 1');
		expect(node.strokes[0].cap).toBe('ARROW_LINES');
	});
});

describe('polygon and star', () => {
	it('create with 3 sides and 5 points by default', async () => {
		const ctx = await mountShapes();
		ctx.tools.activate('polygon');
		drag(ctx, [700, 700], [760, 760]);
		expect(created(ctx).node).toMatchObject({ type: 'POLYGON', pointCount: 3, name: 'Polygon 1' });
		ctx.tools.activate('star');
		drag(ctx, [700, 700], [760, 760]);
		expect(created(ctx).node).toMatchObject({ type: 'STAR', pointCount: 5, name: 'Star 1' });
	});
});
