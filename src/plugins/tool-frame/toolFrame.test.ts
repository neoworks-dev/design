import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import corePanels from '../core-panels';
import { chooseFramePreset, FramePresetState } from './framePresets.svelte';
import { FRAME_PRESET_GROUPS } from './presets';
import toolFrame from './index';

// The frame tool only reads the camera of the viewport service (for its labels).
const fakeViewport = {
	name: 'viewport',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('viewport', { camera: { x: 0, y: 0, scale: 1 } })
} as Plugin;

function providers(): Plugin[] {
	return [...editingProviders(), corePanels, coreTools, fakeViewport];
}

describePlugin('tool-frame', toolFrame, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('frame')).toBeDefined();
		expect(ctx.keymap.registry.listAll().map((binding) => binding.chord)).toContain('f');
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'tool-frame/labels'
		);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountFrame(): Promise<Context> {
	mounted = await mountPlugin(toolFrame, { providers: providers() });
	return mounted.ctx;
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

function drag(ctx: Context, from: [number, number], to: [number, number]): void {
	ctx.tools.pointerDown(pointerEvent(from[0], from[1]));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1]));
	ctx.tools.pointerUp(pointerEvent(to[0], to[1]));
}

describe('frame tool', () => {
	it('draws a white frame named "Frame 1" on the page and reverts to Move', async () => {
		const ctx = await mountFrame();
		ctx.tools.activate('frame');
		drag(ctx, [700, 700], [900, 1000]);
		const node = ctx.document.require(ctx.selection.ids[0]);
		expect(node).toMatchObject({ type: 'FRAME', name: 'Frame 1', width: 200, height: 300 });
		expect(node.parentId).toBe('p');
		if (node.type !== 'FRAME') throw new Error('expected a frame');
		expect(node.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 1, b: 1 } });
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('nests into the frame under the pointer; undo and redo work', async () => {
		const ctx = await mountFrame();
		ctx.tools.activate('frame');
		drag(ctx, [150, 150], [250, 250]);
		const id = ctx.selection.ids[0];
		expect(ctx.document.require(id).parentId).toBe('f');
		expect(ctx.document.absoluteBounds(id)).toMatchObject({ x: 150, y: 150 });
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
		ctx.history.redo();
		expect(ctx.document.require(id).parentId).toBe('f');
	});

	it('a click creates a 100 x 100 frame', async () => {
		const ctx = await mountFrame();
		ctx.tools.activate('frame');
		ctx.tools.pointerDown(pointerEvent(700, 700));
		ctx.tools.pointerUp(pointerEvent(700, 700));
		expect(ctx.document.require(ctx.selection.ids[0])).toMatchObject({ width: 100, height: 100 });
	});
});

describe('frame presets', () => {
	const phone = FRAME_PRESET_GROUPS[0].presets[0];

	it('a preset on the selected frame resizes and renames it in one undo step', async () => {
		const ctx = await mountFrame();
		ctx.selection.select(['f']);
		const state = new FramePresetState();
		chooseFramePreset(ctx, state, phone);
		expect(ctx.document.require('f')).toMatchObject({
			name: phone.name,
			width: phone.width,
			height: phone.height
		});
		ctx.history.undo();
		expect(ctx.document.require('f')).toMatchObject({ name: 'F', width: 400, height: 400 });
	});

	it('without a selected frame the preset is armed: the next click creates it', async () => {
		const ctx = await mountFrame();
		ctx.selection.clear();
		ctx.tools.activate('frame');
		const section = ctx.panels.sectionRegistry
			.listAll()
			.find((entry) => entry.id.endsWith('frame-presets'));
		const state = section?.content.props?.presetState;
		if (!(state instanceof FramePresetState)) throw new Error('presets section has no state');
		chooseFramePreset(ctx, state, phone);
		expect(state.armed).toEqual(phone);
		ctx.tools.pointerDown(pointerEvent(700, 700));
		ctx.tools.pointerUp(pointerEvent(700, 700));
		expect(ctx.document.require(ctx.selection.ids[0])).toMatchObject({
			name: phone.name,
			width: phone.width,
			height: phone.height
		});
		expect(state.armed).toBeNull();
	});
});
