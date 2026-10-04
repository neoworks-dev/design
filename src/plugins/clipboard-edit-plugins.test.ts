// Mount tests and behaviour for the duplicate, align, clipboard and mask plugins.

import type { Context } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { createNode } from '../lib/document';
import { describePlugin, mountPlugin } from '../lib/kernel/testing';
import { editingProviders, at } from '../lib/editing/fixtures/editingFixture';
import duplicate from './duplicate';

function boundKeys(ctx: Context): string[] {
	return ctx.keymap.registry.listAll().map((binding) => `${binding.chord}>${binding.command}`);
}

interface Modifiers {
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

function press(ctx: Context, key: string, modifiers: Modifiers = {}): boolean {
	return ctx.keymap.handleKeydown({
		key,
		ctrlKey: modifiers.ctrl === true,
		metaKey: false,
		altKey: modifiers.alt === true,
		shiftKey: modifiers.shift === true,
		repeat: false
	});
}

function move(ctx: Context, id: string, x: number, y: number): void {
	ctx.document.apply(ctx.document.setProps(id, { transform: at(x, y) }), {
		origin: 'user',
		label: 'Move'
	});
}

describePlugin('duplicate', duplicate, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		expect(boundKeys(ctx)).toContain('ctrl+d>duplicate.duplicate');
		expect(ctx.commands.has('duplicate.duplicate')).toBe(true);
		expect(ctx.menus.has('context/canvas')).toBe(true);
	}
});

describe('duplicate through the keymap', () => {
	it('duplicates in place, repeats the moved offset and undoes in one step', async () => {
		const { ctx, cleanup } = await mountPlugin(duplicate, { providers: editingProviders() });
		ctx.selection.select(['a']);
		press(ctx, 'd', { ctrl: true });
		const [first] = ctx.selection.ids;
		expect(first).not.toBe('a');
		expect(ctx.document.absoluteBounds(first)).toMatchObject({ x: 100, y: 100 });
		expect([...ctx.document.children('f')]).toEqual(['a', first, 'b', 'c']);

		move(ctx, first, 25, 15);
		press(ctx, 'd', { ctrl: true });
		const [second] = ctx.selection.ids;
		expect(ctx.document.absoluteBounds(second)).toMatchObject({ x: 150, y: 130 });
		press(ctx, 'd', { ctrl: true });
		const [third] = ctx.selection.ids;
		expect(ctx.document.absoluteBounds(third)).toMatchObject({ x: 175, y: 145 });

		ctx.history.undo();
		expect(ctx.document.has(third)).toBe(false);
		expect(ctx.document.has(second)).toBe(true);
		await cleanup();
	});

	it('forgets the offset when something else is selected', async () => {
		const { ctx, cleanup } = await mountPlugin(duplicate, { providers: editingProviders() });
		ctx.selection.select(['a']);
		press(ctx, 'd', { ctrl: true });
		const [clone] = ctx.selection.ids;
		move(ctx, clone, 50, 50);
		ctx.selection.select(['b']);
		press(ctx, 'd', { ctrl: true });
		const [copyOfB] = ctx.selection.ids;
		expect(ctx.document.absoluteBounds(copyOfB)).toMatchObject({ x: 120, y: 120 });
		await cleanup();
	});

	it('duplicates a component into a new component with its own key', async () => {
		const { ctx, cleanup } = await mountPlugin(duplicate, { providers: editingProviders() });
		const component = createNode('COMPONENT', {
			id: 'comp',
			name: 'C',
			parentId: 'p',
			index: 'a5'
		});
		ctx.document.apply(ctx.document.insertNode(component), { origin: 'user', label: 'Add' });
		ctx.selection.select(['comp']);
		press(ctx, 'd', { ctrl: true });
		const [copy] = ctx.selection.ids;
		expect(ctx.document.get(copy)).toMatchObject({ type: 'COMPONENT', key: copy });
		await cleanup();
	});
});
