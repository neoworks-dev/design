import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import toolSlice from './index';

// The slice outlines only read the camera of the viewport service.
const fakeViewport = {
	name: 'viewport',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('viewport', { camera: { x: 0, y: 0, scale: 1 } })
} as Plugin;

function providers(): Plugin[] {
	return [...editingProviders(), coreTools, fakeViewport];
}

describePlugin('tool-slice', toolSlice, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('slice')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord.toLowerCase());
		expect(chords).toContain('s');
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'tool-slice/outlines'
		);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

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

async function drawSlice(from: [number, number], to: [number, number]): Promise<Context> {
	mounted = await mountPlugin(toolSlice, { providers: providers() });
	const ctx = mounted.ctx;
	ctx.tools.activate('slice');
	ctx.tools.pointerDown(pointerEvent(from[0], from[1]));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1]));
	ctx.tools.pointerUp(pointerEvent(to[0], to[1]));
	return ctx;
}

describe('slice tool', () => {
	it('creates a slice with one 1x PNG export setting', async () => {
		const ctx = await drawSlice([700, 700], [900, 1000]);
		const node = ctx.document.require(ctx.selection.ids[0]);
		expect(node).toMatchObject({ type: 'SLICE', name: 'Slice 1', width: 200, height: 300 });
		expect(node.type === 'SLICE' && node.exportSettings).toEqual([
			{ suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } }
		]);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('nests into the frame under the pointer and undoes in one step', async () => {
		const ctx = await drawSlice([150, 150], [250, 250]);
		const id = ctx.selection.ids[0];
		expect(ctx.document.require(id).parentId).toBe('f');
		expect(ctx.history.undoLabel).toBe('Create Slice');
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
		expect(ctx.history.canUndo).toBe(false);
	});
});
