import type { Context } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import { decodePayload } from '../../lib/editing/clipboardPayload';
import { clipboardWorld } from '../../lib/editing/fixtures/clipboardFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import clipboard from '.';

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

function boundKeys(ctx: Context): string[] {
	return ctx.keymap.registry.listAll().map((binding) => `${binding.chord}>${binding.command}`);
}

describePlugin('clipboard', clipboard, {
	providers: clipboardWorld().providers,
	contributes: ({ ctx }) => {
		const chords = boundKeys(ctx);
		expect(chords).toContain('ctrl+c>clipboard.copy');
		expect(chords).toContain('ctrl+x>clipboard.cut');
		expect(chords).toContain('ctrl+v>clipboard.paste');
		expect(chords).toContain('ctrl+shift+v>clipboard.paste-over-selection');
		expect(chords).toContain('ctrl+shift+r>clipboard.paste-replace');
		expect(chords).toContain('ctrl+shift+c>clipboard.copy-as-png');
		expect(chords).toContain('ctrl+alt+c>clipboard.copy-properties');
		expect(chords).toContain('ctrl+alt+v>clipboard.paste-properties');
		const ids = ['paste-here', 'paste-in-place', 'copy-as-svg', 'copy-as-css'];
		for (const id of ids) expect(ctx.commands.has(`clipboard.${id}`)).toBe(true);
		expect(ctx.menus.has('context/canvas-empty')).toBe(true);
		expect(ctx.menus.has('context/copy-as')).toBe(true);
	}
});

async function mountClipboard(): Promise<{
	ctx: Context;
	world: ReturnType<typeof clipboardWorld>;
	cleanup: () => Promise<void>;
}> {
	const world = clipboardWorld();
	world.viewport.rect = { x: 0, y: 0, width: 1000, height: 800 };
	const mounted = await mountPlugin(clipboard, { providers: world.providers });
	mounted.ctx.keymap.pushScope('canvas');
	return { ctx: mounted.ctx, world, cleanup: mounted.cleanup };
}

async function copied(world: ReturnType<typeof clipboardWorld>): Promise<void> {
	await vi.waitFor(async () => expect((await world.bridge.clipboard.read()).html).not.toBeNull());
}

describe('clipboard through the keymap', () => {
	it('copies with Ctrl+C onto the OS clipboard and pastes with Ctrl+V as one undo step', async () => {
		const { ctx, world, cleanup } = await mountClipboard();
		ctx.selection.select(['a']);
		press(ctx, 'c', { ctrl: true });
		await copied(world);
		const content = await world.bridge.clipboard.read();
		expect(content.text).toBe('a');
		expect(decodePayload(content.html)?.roots).toHaveLength(1);

		ctx.selection.select(['f']);
		press(ctx, 'v', { ctrl: true });
		await vi.waitFor(() => expect(ctx.document.children('f')).toHaveLength(4));
		const [pasted] = ctx.selection.ids;
		expect(ctx.document.get(pasted)).toMatchObject({ name: 'a', parentId: 'f' });
		expect(ctx.document.absoluteBounds(pasted)).toMatchObject({ x: 100, y: 100 });
		ctx.history.undo();
		expect(ctx.document.children('f')).toHaveLength(3);
		await cleanup();
	});

	it('cuts, removing the nodes, and pastes them back', async () => {
		const { ctx, cleanup } = await mountClipboard();
		ctx.selection.select(['b', 'c']);
		press(ctx, 'x', { ctrl: true });
		await vi.waitFor(() => expect([...ctx.document.children('f')]).toEqual(['a']));
		ctx.selection.select(['f']);
		press(ctx, 'v', { ctrl: true });
		await vi.waitFor(() => expect(ctx.document.children('f')).toHaveLength(3));
		expect(ctx.selection.count).toBe(2);
		await cleanup();
	});

	it('offers the headless renderer a chance to add a PNG', async () => {
		const { ctx, world, cleanup } = await mountClipboard();
		const png = new Uint8Array([1, 2, 3]);
		ctx.on('clipboard/render-png', (_ids, next) => next().then(() => png));
		ctx.selection.select(['a']);
		press(ctx, 'c', { ctrl: true });
		await vi.waitFor(async () => expect((await world.bridge.clipboard.read()).png).toEqual(png));
		await cleanup();
	});

	it('pastes plain text as a text node and an image as an image rectangle with its asset', async () => {
		const { ctx, world, cleanup } = await mountClipboard();
		await world.bridge.clipboard.write({ text: 'hello\nworld' });
		press(ctx, 'v', { ctrl: true });
		await vi.waitFor(() => expect(ctx.selection.count).toBe(1));
		const [textId] = ctx.selection.ids;
		expect(ctx.document.get(textId)).toMatchObject({ type: 'TEXT', name: 'hello' });

		await world.bridge.clipboard.write({ png: new Uint8Array([9, 9, 9, 9]) });
		press(ctx, 'v', { ctrl: true });
		await vi.waitFor(() => expect(ctx.selection.ids[0]).not.toBe(textId));
		const [imageId] = ctx.selection.ids;
		expect(ctx.document.get(imageId)).toMatchObject({ type: 'RECTANGLE', width: 40, height: 20 });
		expect(ctx.document.getEntity('asset', 'hash-4')).toBeDefined();
		ctx.history.undo();
		expect(ctx.document.has(imageId)).toBe(false);
		expect(ctx.document.getEntity('asset', 'hash-4')).toBeUndefined();
		await cleanup();
	});

	it('paste here puts the top left on the cursor passed as the menu target', async () => {
		const { ctx, world, cleanup } = await mountClipboard();
		ctx.selection.select(['loose']);
		press(ctx, 'c', { ctrl: true });
		await copied(world);
		ctx.selection.clear();
		await ctx.commands.run('clipboard.paste-here', { world: { x: 50, y: 70 } });
		await vi.waitFor(() => expect(ctx.selection.count).toBe(1));
		expect(ctx.document.absoluteBounds(ctx.selection.ids[0])).toMatchObject({ x: 50, y: 70 });
		await cleanup();
	});

	it('paste to replace swaps the selection for the clipboard content', async () => {
		const { ctx, world, cleanup } = await mountClipboard();
		ctx.selection.select(['loose']);
		press(ctx, 'c', { ctrl: true });
		await copied(world);
		ctx.selection.select(['b']);
		press(ctx, 'r', { ctrl: true, shift: true });
		await vi.waitFor(() => expect(ctx.document.has('b')).toBe(false));
		expect(ctx.document.children('f')).toHaveLength(3);
		await cleanup();
	});
});
