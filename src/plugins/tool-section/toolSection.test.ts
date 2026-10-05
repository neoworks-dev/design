import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import toolSection from './index';

function providers(): Plugin[] {
	return [...editingProviders(), coreTools];
}

describePlugin('tool-section', toolSection, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('section')).toBeDefined();
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord.toLowerCase());
		expect(chords).toContain('shift+s');
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

async function drawSection(from: [number, number], to: [number, number]): Promise<Context> {
	mounted = await mountPlugin(toolSection, { providers: providers() });
	const ctx = mounted.ctx;
	ctx.tools.activate('section');
	ctx.tools.pointerDown(pointerEvent(from[0], from[1]));
	ctx.tools.pointerMove(pointerEvent(to[0], to[1]));
	ctx.tools.pointerUp(pointerEvent(to[0], to[1]));
	return ctx;
}

describe('section tool', () => {
	it('creates a named section with a fill and selects it, then reverts to Move', async () => {
		const ctx = await drawSection([700, 700], [900, 1000]);
		const node = ctx.document.require(ctx.selection.ids[0]);
		expect(node).toMatchObject({ type: 'SECTION', name: 'Section 1', width: 200, height: 300 });
		expect(node.type === 'SECTION' && node.fills).toHaveLength(1);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('is always created on the page, also when drawn inside a frame', async () => {
		const ctx = await drawSection([150, 150], [250, 250]);
		const node = ctx.document.require(ctx.selection.ids[0]);
		expect(node.parentId).toBe('p');
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({ x: 150, y: 150 });
	});

	it('is one undo step', async () => {
		const ctx = await drawSection([700, 700], [900, 1000]);
		const id = ctx.selection.ids[0];
		expect(ctx.history.undoLabel).toBe('Create Section');
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
		expect(ctx.history.canUndo).toBe(false);
		ctx.history.redo();
		expect(ctx.document.has(id)).toBe(true);
	});
});
