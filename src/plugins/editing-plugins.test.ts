// Mount tests and behaviour through commands and keys for the editing plugins: nudge, z-order,
// grouping and node-commands.

import type { Context } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import { describePlugin, mountPlugin } from '../lib/kernel/testing';
import { editingProviders } from '../lib/editing/fixtures/editingFixture';
import grouping from './grouping';
import nodeCommands from './node-commands';
import nudge from './nudge';
import zOrder from './z-order';

function boundKeys(ctx: Context): string[] {
	return ctx.keymap.registry.listAll().map((binding) => `${binding.chord}>${binding.command}`);
}

describePlugin('nudge', nudge, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		const chords = boundKeys(ctx);
		for (const direction of ['left', 'right', 'up', 'down']) {
			expect(ctx.commands.has(`nudge.${direction}`)).toBe(true);
			expect(ctx.commands.has(`nudge.${direction}-big`)).toBe(true);
		}
		expect(chords).toContain('arrowleft>nudge.left');
		expect(chords).toContain('shift+arrowdown>nudge.down-big');
		const repeating = ctx.keymap.registry.listAll().filter((binding) => binding.repeat);
		expect(repeating).toHaveLength(8);
	}
});

describePlugin('z-order', zOrder, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		const chords = boundKeys(ctx);
		expect(chords).toContain(']>z-order.front');
		expect(chords).toContain('[>z-order.back');
		expect(chords).toContain('ctrl+]>z-order.forward');
		expect(chords).toContain('ctrl+[>z-order.backward');
		expect(ctx.menus.has('context/canvas')).toBe(true);
		expect(ctx.menus.has('context/layer')).toBe(true);
	}
});

describePlugin('grouping', grouping, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		const chords = boundKeys(ctx);
		expect(chords).toContain('ctrl+g>grouping.group');
		expect(chords).toContain('ctrl+alt+g>grouping.frame-selection');
		expect(chords).toContain('ctrl+shift+g>grouping.ungroup');
		expect(chords).toContain('ctrl+delete>grouping.ungroup');
		expect(ctx.menus.has('context/layer')).toBe(true);
	}
});

describePlugin('node-commands', nodeCommands, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		const chords = boundKeys(ctx);
		const expected: Record<string, string> = {
			'shift+h': 'node.flip-horizontal',
			'shift+v': 'node.flip-vertical',
			'ctrl+shift+h': 'node.toggle-visibility',
			'ctrl+shift+l': 'node.toggle-lock',
			delete: 'node.delete',
			backspace: 'node.delete',
			'shift+x': 'node.swap-fill-stroke',
			'ctrl+f': 'node.find',
			'ctrl+r': 'node.rename'
		};
		for (const [chord, command] of Object.entries(expected)) {
			expect(chords).toContain(`${chord}>${command}`);
			expect(ctx.commands.has(command)).toBe(true);
		}
		for (let digit = 0; digit <= 9; digit += 1) {
			expect(chords).toContain(`${digit}>node.set-opacity`);
		}
	}
});

interface Keyboard {
	key: string;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	repeat?: boolean;
}

function press(ctx: Context, event: Keyboard): boolean {
	return ctx.keymap.handleKeydown({
		key: event.key,
		ctrlKey: event.ctrlKey === true,
		metaKey: false,
		altKey: event.altKey === true,
		shiftKey: event.shiftKey === true,
		repeat: event.repeat === true
	});
}

function boundsOf(ctx: Context, id: string): { x: number; y: number } {
	return ctx.document.absoluteBounds(id);
}

async function mountAll(): Promise<{ ctx: Context; cleanup: () => Promise<void> }> {
	const mounted = await mountPlugin(nudge, {
		providers: [...editingProviders(), zOrder, grouping, nodeCommands]
	});
	return { ctx: mounted.ctx, cleanup: mounted.cleanup };
}

describe('nudge through the keymap', () => {
	it('moves the selection, coalesces repeats into one undo step and undoes', async () => {
		const { ctx, cleanup } = await mountAll();
		ctx.selection.select(['a']);
		const start = boundsOf(ctx, 'a');
		press(ctx, { key: 'ArrowRight' });
		press(ctx, { key: 'ArrowRight', repeat: true });
		press(ctx, { key: 'ArrowDown', shiftKey: true });
		expect(boundsOf(ctx, 'a')).toMatchObject({ x: start.x + 2, y: start.y + 10 });
		expect(ctx.history.canUndo).toBe(true);
		ctx.history.undo();
		expect(boundsOf(ctx, 'a')).toMatchObject({ x: start.x, y: start.y });
		expect(ctx.history.canUndo).toBe(false);
		await cleanup();
	});

	it('leaves arrow keys to other bindings when nothing is selected', async () => {
		const { ctx, cleanup } = await mountAll();
		const ran = vi.fn();
		ctx.on('command/run', ran);
		press(ctx, { key: 'ArrowLeft', shiftKey: true });
		expect(ran).not.toHaveBeenCalled();
		await cleanup();
	});

	it('does not move auto layout children and says so', async () => {
		const { ctx, cleanup } = await mountAll();
		const blocked = vi.fn();
		ctx.on('nudge/blocked', blocked);
		ctx.document.apply(ctx.document.setProps('f', { layoutMode: 'VERTICAL' }), {
			origin: 'user',
			label: 'Auto layout'
		});
		ctx.selection.select(['b']);
		const start = boundsOf(ctx, 'b');
		press(ctx, { key: 'ArrowRight' });
		expect(boundsOf(ctx, 'b')).toMatchObject({ x: start.x, y: start.y });
		expect(blocked).toHaveBeenCalledWith(['b']);
		await cleanup();
	});
});

describe('z-order, grouping and node commands through the keymap', () => {
	it('reorders with the bracket keys and undoes', async () => {
		const { ctx, cleanup } = await mountAll();
		ctx.selection.select(['a']);
		press(ctx, { key: ']' });
		expect([...ctx.document.children('f')]).toEqual(['b', 'c', 'a']);
		press(ctx, { key: '[' });
		expect([...ctx.document.children('f')]).toEqual(['a', 'b', 'c']);
		press(ctx, { key: ']', ctrlKey: true });
		expect([...ctx.document.children('f')]).toEqual(['b', 'a', 'c']);
		ctx.history.undo();
		expect([...ctx.document.children('f')]).toEqual(['a', 'b', 'c']);
		await cleanup();
	});

	it('groups with Ctrl+G, selects the group, ungroups and undo restores the structure', async () => {
		const { ctx, cleanup } = await mountAll();
		const original = JSON.stringify(ctx.document.snapshot.nodes);
		ctx.selection.select(['a', 'b']);
		press(ctx, { key: 'g', ctrlKey: true });
		const [groupId] = ctx.selection.ids;
		expect(ctx.document.get(groupId)).toMatchObject({ type: 'GROUP', name: 'Group 1' });
		expect([...ctx.document.children(groupId)]).toEqual(['a', 'b']);
		expect(boundsOf(ctx, 'a')).toMatchObject({ x: 100, y: 100 });
		press(ctx, { key: 'g', ctrlKey: true, shiftKey: true });
		expect([...ctx.selection.ids]).toEqual(['a', 'b']);
		expect([...ctx.document.children('f')]).toEqual(['a', 'b', 'c']);
		ctx.history.undo();
		ctx.history.undo();
		expect(JSON.stringify(ctx.document.snapshot.nodes)).toBe(original);
		await cleanup();
	});

	it('frames the selection with Ctrl+Alt+G', async () => {
		const { ctx, cleanup } = await mountAll();
		ctx.selection.select(['loose']);
		press(ctx, { key: 'g', ctrlKey: true, altKey: true });
		const [frameId] = ctx.selection.ids;
		expect(ctx.document.get(frameId)).toMatchObject({ type: 'FRAME', name: 'Frame 1' });
		await cleanup();
	});

	it('flips, hides, locks, sets opacity, deletes and finds', async () => {
		const { ctx, cleanup } = await mountAll();
		ctx.selection.select(['a']);
		press(ctx, { key: 'H', shiftKey: true });
		expect(ctx.document.get('a')).toMatchObject({
			transform: [
				[-1, 0, 10],
				[0, 1, 0]
			]
		});
		press(ctx, { key: 'h', ctrlKey: true, shiftKey: true });
		expect(ctx.document.get('a')).toMatchObject({ visible: false });
		press(ctx, { key: 'l', ctrlKey: true, shiftKey: true });
		expect(ctx.document.get('a')).toMatchObject({ locked: true });
		press(ctx, { key: '5' });
		expect(ctx.document.get('a')).toMatchObject({ opacity: 0.5 });
		press(ctx, { key: '0' });
		expect(ctx.document.get('a')).toMatchObject({ opacity: 1 });
		press(ctx, { key: 'Delete' });
		expect(ctx.document.has('a')).toBe(false);
		expect(ctx.selection.count).toBe(0);
		ctx.history.undo();
		expect(ctx.document.has('a')).toBe(true);

		await ctx.commands.run('node.find', { query: 'LOOSE' });
		expect([...ctx.selection.ids]).toEqual(['loose']);
		const requested = vi.fn();
		ctx.on('node-commands/find-request', requested);
		await ctx.commands.run('node.find');
		expect(requested).toHaveBeenCalled();
		await ctx.commands.run('node.rename', { name: 'Hero' });
		expect(ctx.document.get('loose')?.name).toBe('Hero');
		await cleanup();
	});

	it('does nothing for edit keys while the selection is empty', async () => {
		const { ctx, cleanup } = await mountAll();
		const before = JSON.stringify(ctx.document.snapshot.nodes);
		expect(press(ctx, { key: 'Delete' })).toBe(false);
		expect(press(ctx, { key: 'g', ctrlKey: true })).toBe(false);
		expect(JSON.stringify(ctx.document.snapshot.nodes)).toBe(before);
		await cleanup();
	});
});
