import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { createNode, parseNode } from '../../lib/document';
import type { NodeId, VectorNetwork } from '../../lib/document';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolKeyEvent, ToolPointerEvent } from '../../lib/tools/protocol';
import corePanels from '../core-panels';
import {
	selectedMirroring,
	selectedRadius,
	setMirroringOnSelection,
	setRadiusOnSelection
} from '../../lib/vector/editAdvanced';
import { VectorEditState } from '../../lib/vector/editState';
import { VectorEditor } from '../../lib/vector/editTool';
import coreTools from '../core-tools';
import overlay from '../overlay';
import vectorEdit from './index';

const fakeViewport = {
	name: 'fake-viewport',
	inject: [],
	apply: (ctx: Context) =>
		void ctx.provide('viewport', {
			camera: { x: 0, y: 0, scale: 1 },
			zoom: 1,
			worldToScreen: (point: { x: number; y: number }) => point
		})
} as Plugin;

function providers(): Plugin[] {
	return [...editingProviders(), corePanels, coreTools, fakeViewport, overlay];
}

describePlugin('vector-edit', vectorEdit, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('vector-edit')).toBeDefined();
		expect(ctx.tools.toolbarTools().map((entry) => entry.id)).not.toContain('vector-edit');
		for (const id of ['delete', 'delete-and-heal', 'join', 'flatten', 'exit', 'paint-bucket']) {
			expect(ctx.commands.has(`vector.${id}`)).toBe(true);
		}
		expect(ctx.overlay.contributions().map((entry) => entry.id)).toContain('vector-edit/network');
		expect(ctx.menus.has('context/canvas')).toBe(true);
		expect(ctx.panels.sectionRegistry.listAll().map((section) => section.id)).toContain(
			'design/vector-vertex'
		);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

/** An open path (0,0) (100,0) (100,100) (0,100), placed at (200, 200) on the page. */
function openPath(): VectorNetwork {
	return {
		vertices: [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
			{ x: 0, y: 100 }
		],
		segments: [
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 2, end: 3 }
		]
	};
}

async function mountEditor(
	network: VectorNetwork = openPath()
): Promise<{ ctx: Context; id: NodeId }> {
	mounted = await mountPlugin(vectorEdit, { providers: providers() });
	const { ctx } = mounted;
	const node = createNode('VECTOR', {
		name: 'Vector 1',
		transform: [
			[1, 0, 200],
			[0, 1, 200]
		],
		width: 100,
		height: 100,
		network,
		parentId: 'p',
		index: 'a5'
	});
	ctx.document.apply(ctx.document.insertNode(node), { origin: 'user', label: 'Add vector' });
	ctx.selection.select([node.id]);
	ctx.emit('canvas/edit-request', node.id, 'vector');
	return { ctx, id: node.id };
}

interface Held {
	ctrlKey?: boolean;
	altKey?: boolean;
}

function pointer(
	x: number,
	y: number,
	shiftKey = false,
	detail = 1,
	held: Held = {}
): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail,
		pointerId: 1,
		shiftKey,
		altKey: held.altKey === true,
		ctrlKey: held.ctrlKey === true,
		metaKey: false
	};
}

function key(
	name: string,
	modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}
): ToolKeyEvent {
	return {
		key: name,
		code: name,
		repeat: false,
		shiftKey: modifiers.shiftKey === true,
		altKey: false,
		ctrlKey: modifiers.ctrlKey === true,
		metaKey: false,
		preventDefault: () => undefined
	};
}

function click(ctx: Context, x: number, y: number, shiftKey = false): void {
	ctx.tools.pointerDown(pointer(x, y, shiftKey));
	ctx.tools.pointerUp(pointer(x, y, shiftKey));
}

function drag(ctx: Context, from: [number, number], to: [number, number]): void {
	ctx.tools.pointerDown(pointer(from[0], from[1]));
	ctx.tools.pointerMove(pointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
	ctx.tools.pointerMove(pointer(to[0], to[1]));
	ctx.tools.pointerUp(pointer(to[0], to[1]));
}

function networkOf(ctx: Context, id: NodeId): VectorNetwork {
	const node = ctx.document.require(id);
	if (node.type !== 'VECTOR') throw new Error('not a vector');
	return node.network;
}

/** Absolute position of vertex `index`. */
function worldVertex(ctx: Context, id: NodeId, index: number): { x: number; y: number } {
	const vertex = networkOf(ctx, id).vertices[index];
	const bounds = ctx.document.absoluteBounds(id);
	return { x: bounds.x + vertex.x, y: bounds.y + vertex.y };
}

describe('entering and leaving', () => {
	it('the edit request opens the mode; Esc and Enter leave it', async () => {
		const { ctx } = await mountEditor();
		expect(ctx.tools.activeId()).toBe('vector-edit');
		expect(ctx.tools.keyDown(key('Escape'))).toBe(true);
		expect(ctx.tools.activeId()).toBe('move');
		ctx.emit('canvas/edit-request', ctx.selection.ids[0], 'vector');
		expect(ctx.tools.activeId()).toBe('vector-edit');
		ctx.tools.keyDown(key('Enter'));
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('Esc through the tool service leaves the mode too', async () => {
		const { ctx } = await mountEditor();
		expect(ctx.tools.cancel()).toBe(true);
		expect(ctx.tools.activeId()).toBe('move');
	});
});

describe('selecting and moving', () => {
	it('a drag moves the vertex as one undo step and undo restores it', async () => {
		const { ctx, id } = await mountEditor();
		const before = structuredClone(networkOf(ctx, id));
		drag(ctx, [300, 200], [330, 250]);
		const moved = worldVertex(ctx, id, 1);
		expect(moved).toEqual({ x: 330, y: 250 });
		expect(worldVertex(ctx, id, 0)).toEqual({ x: 200, y: 200 });
		expect(ctx.history.undo()).toBe(true);
		expect(networkOf(ctx, id)).toEqual(before);
		expect(ctx.document.absoluteBounds(id)).toMatchObject({ x: 200, y: 200 });
	});

	it('Shift-click adds a vertex and the group moves together', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 300, 200);
		click(ctx, 300, 300, true);
		drag(ctx, [300, 200], [310, 190]);
		expect(worldVertex(ctx, id, 1)).toEqual({ x: 310, y: 190 });
		expect(worldVertex(ctx, id, 2)).toEqual({ x: 310, y: 290 });
	});

	it('a marquee selects the vertices inside it', async () => {
		const { ctx, id } = await mountEditor();
		drag(ctx, [290, 190], [310, 310]);
		ctx.tools.keyDown(key('ArrowRight', { shiftKey: true }));
		expect(worldVertex(ctx, id, 1).x).toBe(310);
		expect(worldVertex(ctx, id, 2).x).toBe(310);
		expect(worldVertex(ctx, id, 0).x).toBe(200);
	});

	it('arrow keys nudge the selection by 1 and Shift by 10', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 200, 200);
		ctx.tools.keyDown(key('ArrowDown'));
		expect(worldVertex(ctx, id, 0)).toEqual({ x: 200, y: 201 });
		ctx.tools.keyDown(key('ArrowLeft', { shiftKey: true }));
		expect(worldVertex(ctx, id, 0)).toEqual({ x: 190, y: 201 });
	});

	it('dragging a segment moves both its endpoints', async () => {
		const { ctx, id } = await mountEditor();
		drag(ctx, [300, 250], [320, 250]);
		expect(worldVertex(ctx, id, 1).x).toBe(320);
		expect(worldVertex(ctx, id, 2).x).toBe(320);
	});
});

describe('delete, heal and join', () => {
	it('Delete removes the vertex and its segments from an open path', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 300, 200);
		ctx.tools.keyDown(key('Delete'));
		const network = networkOf(ctx, id);
		expect(network.vertices).toHaveLength(3);
		expect(network.segments).toEqual([{ start: 1, end: 2 }]);
	});

	it('Shift+Delete deletes and heals: the neighbours are reconnected', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 300, 200);
		ctx.tools.keyDown(key('Delete', { shiftKey: true }));
		const network = networkOf(ctx, id);
		expect(network.vertices).toHaveLength(3);
		expect(network.segments).toHaveLength(2);
		expect(ctx.history.undo()).toBe(true);
		expect(networkOf(ctx, id).vertices).toHaveLength(4);
	});

	it('Ctrl+J joins two selected endpoints with a segment', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 200, 200);
		click(ctx, 200, 300, true);
		ctx.tools.keyDown(key('j', { ctrlKey: true }));
		const network = networkOf(ctx, id);
		expect(network.segments).toHaveLength(4);
		expect(network.segments[3]).toEqual({ start: 0, end: 3 });
		expect(network.regions).toHaveLength(1);
	});

	it('Join does nothing for vertices that are not endpoints', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 300, 200);
		click(ctx, 300, 300, true);
		ctx.tools.keyDown(key('j', { ctrlKey: true }));
		expect(networkOf(ctx, id).segments).toHaveLength(3);
	});

	it('deleting every vertex removes the node and leaves the mode', async () => {
		const { ctx, id } = await mountEditor();
		drag(ctx, [150, 150], [350, 350]);
		ctx.tools.keyDown(key('Delete'));
		expect(ctx.document.has(id)).toBe(false);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('the commands run through the registry and respect the mode', async () => {
		const { ctx, id } = await mountEditor();
		click(ctx, 300, 200);
		await ctx.commands.run('vector.delete');
		expect(networkOf(ctx, id).vertices).toHaveLength(3);
		await ctx.commands.run('vector.exit');
		expect(ctx.tools.activeId()).toBe('move');
	});
});

function dragHeld(ctx: Context, from: [number, number], to: [number, number], held: Held): void {
	ctx.tools.pointerDown(pointer(from[0], from[1], false, 1, held));
	ctx.tools.pointerMove(pointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, false, 1, held));
	ctx.tools.pointerMove(pointer(to[0], to[1], false, 1, held));
	ctx.tools.pointerUp(pointer(to[0], to[1], false, 1, held));
}

function clickHeld(ctx: Context, at: [number, number], held: Held): void {
	ctx.tools.pointerDown(pointer(at[0], at[1], false, 1, held));
	ctx.tools.pointerUp(pointer(at[0], at[1], false, 1, held));
}

/** A smooth path (0,100) (100,100 with mirrored handles) (200,100), placed at (200, 200). */
function smoothPath(
	mode: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH' = 'ANGLE_AND_LENGTH'
): VectorNetwork {
	return {
		vertices: [
			{ x: 0, y: 100 },
			{ x: 100, y: 100, handleMirroring: mode },
			{ x: 200, y: 100 }
		],
		segments: [
			{ start: 0, end: 1, tangentEnd: { x: -30, y: 0 } },
			{ start: 1, end: 2, tangentStart: { x: 30, y: 0 } }
		]
	};
}

describe('bend tool (Ctrl)', () => {
	it('dragging a corner vertex converts it to a curve with mirrored handles', async () => {
		const { ctx, id } = await mountEditor();
		dragHeld(ctx, [300, 200], [300, 240], { ctrlKey: true });
		const network = networkOf(ctx, id);
		expect(network.segments[1].tangentStart).toEqual({ x: 0, y: 40 });
		expect(network.segments[0].tangentEnd).toEqual({ x: 0, y: -40 });
		expect(network.vertices[1].handleMirroring).toBe('ANGLE_AND_LENGTH');
		expect(ctx.history.undo()).toBe(true);
		expect(networkOf(ctx, id).segments[0].tangentEnd).toBeUndefined();
	});

	it('clicking a vertex with handles removes them', async () => {
		const { ctx, id } = await mountEditor();
		dragHeld(ctx, [300, 200], [300, 240], { ctrlKey: true });
		clickHeld(ctx, [300, 200], { ctrlKey: true });
		const network = networkOf(ctx, id);
		expect(network.segments[0].tangentEnd).toBeUndefined();
		expect(network.segments[1].tangentStart).toBeUndefined();
	});

	it('dragging a segment bends it so the curve follows the pointer', async () => {
		const { ctx, id } = await mountEditor();
		dragHeld(ctx, [300, 250], [340, 250], { ctrlKey: true });
		const network = networkOf(ctx, id);
		expect(network.segments[1].tangentStart).toBeDefined();
		expect(network.segments[1].tangentEnd).toBeDefined();
		expect(ctx.history.undo()).toBe(true);
		expect(networkOf(ctx, id).segments[1].tangentStart).toBeUndefined();
	});
});

describe('handles and mirroring', () => {
	async function mountSmooth(
		mode: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'
	): Promise<{ ctx: Context; id: NodeId }> {
		const mounted = await mountEditor(smoothPath(mode));
		click(mounted.ctx, 300, 300);
		return mounted;
	}

	it('dragging a handle moves the opposite one per the mirroring mode', async () => {
		const exact = await mountSmooth('ANGLE_AND_LENGTH');
		drag(exact.ctx, [330, 300], [330, 340]);
		const network = networkOf(exact.ctx, exact.id);
		expect(network.segments[1].tangentStart).toEqual({ x: 30, y: 40 });
		expect(network.segments[0].tangentEnd).toEqual({ x: -30, y: -40 });
		await mounted?.cleanup();
		mounted = undefined;
		const free = await mountSmooth('NONE');
		drag(free.ctx, [330, 300], [330, 340]);
		expect(networkOf(free.ctx, free.id).segments[0].tangentEnd).toEqual({ x: -30, y: 0 });
	});

	it('Alt breaks the mirroring for one drag', async () => {
		const { ctx, id } = await mountSmooth('ANGLE_AND_LENGTH');
		dragHeld(ctx, [330, 300], [330, 340], { altKey: true });
		const network = networkOf(ctx, id);
		expect(network.segments[1].tangentStart).toEqual({ x: 30, y: 40 });
		expect(network.segments[0].tangentEnd).toEqual({ x: -30, y: 0 });
	});

	it('Ctrl+click on a handle toggles between mirrored and straight', async () => {
		const { ctx, id } = await mountSmooth('ANGLE_AND_LENGTH');
		clickHeld(ctx, [330, 300], { ctrlKey: true });
		expect(networkOf(ctx, id).vertices[1].handleMirroring).toBe('NONE');
		clickHeld(ctx, [330, 300], { ctrlKey: true });
		expect(networkOf(ctx, id).vertices[1].handleMirroring).toBe('ANGLE_AND_LENGTH');
	});

	it('the panel setters change mirroring and radius for the selected vertices', async () => {
		const { ctx, id } = await mountSmooth('NONE');
		const state = new VectorEditState();
		const editor = new VectorEditor(ctx, state);
		state.open(id);
		state.selectVertices([1], false);
		setMirroringOnSelection(editor, 'ANGLE');
		expect(networkOf(ctx, id).vertices[1].handleMirroring).toBe('ANGLE');
		expect(selectedMirroring(editor)).toBe('ANGLE');
		setRadiusOnSelection(editor, 12);
		expect(networkOf(ctx, id).vertices[1].cornerRadius).toBe(12);
		expect(selectedRadius(editor)).toBe(12);
		setRadiusOnSelection(editor, 0);
		expect(networkOf(ctx, id).vertices[1].cornerRadius).toBeUndefined();
	});
});

describe('paint bucket', () => {
	function square(): VectorNetwork {
		return {
			vertices: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 }
			],
			segments: [
				{ start: 0, end: 1 },
				{ start: 1, end: 2 },
				{ start: 2, end: 3 },
				{ start: 3, end: 0 }
			],
			regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
		};
	}

	it('B fills the region under the click, undo restores it, a second click clears it', async () => {
		const { ctx, id } = await mountEditor(square());
		ctx.tools.keyDown(key('b'));
		click(ctx, 250, 250);
		const filled = networkOf(ctx, id).regions?.[0].fills;
		expect(filled).toHaveLength(1);
		expect(filled?.[0]).toMatchObject({ type: 'SOLID', visible: true });
		expect(ctx.history.undo()).toBe(true);
		expect(networkOf(ctx, id).regions?.[0].fills).toBeUndefined();
		expect(ctx.history.redo()).toBe(true);
		click(ctx, 250, 250);
		expect(networkOf(ctx, id).regions?.[0].fills).toBeUndefined();
	});

	it('clicking outside every region does nothing', async () => {
		const { ctx, id } = await mountEditor(square());
		ctx.tools.keyDown(key('b'));
		click(ctx, 500, 500);
		expect(networkOf(ctx, id).regions?.[0].fills).toBeUndefined();
	});

	it('the filled region is part of the stored node and validates', async () => {
		const { ctx, id } = await mountEditor(square());
		ctx.tools.keyDown(key('b'));
		click(ctx, 250, 250);
		expect(parseNode(ctx.document.require(id)).ok).toBe(true);
	});
});
