import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createNode } from '../../lib/document/defaults';
import { plainText } from '../../lib/document/text';
import type { Paragraph, TextNode } from '../../lib/document/types';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import type { FontEntry, FontRef } from '../../lib/fonts/resolve';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { loadCanvasKit, type CanvasKit } from '../../lib/renderer/canvaskit';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import { DrawHookRegistry, type DrawHooks } from '../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../lib/renderer/ownership';
import { loadTestFaces, paragraphOf, testResolver } from '../../lib/text/testing';
import textLayout from '../text-layout';
import variablesCore from '../variables-core';
import textEdit from './index';

let kit: CanvasKit;
const sinks: { registerFont(face: FontEntry, bytes: ArrayBuffer): void }[] = [];

beforeAll(async () => {
	kit = await loadCanvasKit(nodeWasmLocator());
});

function fakes(): Plugin {
	return {
		name: 'fake-renderer-fonts-viewport',
		inject: [],
		apply(ctx: Context): void {
			const registry = new DrawHookRegistry();
			ctx.provide('renderer', {
				registerDrawHooks: (hooks: Partial<DrawHooks>) => registry.register(hooks)
			});
			ctx.provide('canvaskit', { kit, tracker: new SkiaTracker() });
			ctx.provide('viewport', {
				zoom: 1,
				worldToScreen: (point: { x: number; y: number }) => point,
				screenToWorld: (point: { x: number; y: number }) => point
			});
			ctx.provide('fonts', {
				resolve: testResolver,
				load: (_ref: FontRef) => Promise.resolve(),
				attach: (sink: { registerFont(face: FontEntry, bytes: ArrayBuffer): void }) => {
					sinks.push(sink);
					return () => Promise.resolve();
				}
			});
		}
	} as Plugin;
}

function providers(): Plugin[] {
	return [fakes(), ...editingProviders(), variablesCore, textLayout];
}

describePlugin('text-edit', textEdit, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('text.edit')).toBe(true);
		expect(ctx.commands.has('text.move')).toBe(true);
		expect(ctx.regions.registry.listAll().map((entry) => entry.id)).toContain('text-edit/layer');
	}
});

let mounted: MountedPlugin | undefined;
let host: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountEditor(
	paragraphs: Paragraph[],
	props: Partial<TextNode> = {}
): Promise<Context> {
	sinks.length = 0;
	mounted = await mountPlugin(textEdit, { providers: providers() });
	for (const sink of sinks) {
		for (const { face, bytes } of await loadTestFaces()) sink.registerFont(face, bytes);
	}
	const { ctx } = mounted;
	const base = createNode('TEXT', { id: 't', parentId: 'p', index: 'a0', ...props });
	const node: TextNode = {
		...base,
		...props,
		paragraphs,
		defaultStyle: { ...base.defaultStyle, fontName: { family: 'Geist', style: 'Regular' } }
	};
	ctx.document.apply(ctx.document.insertNode(node), { origin: 'user', label: 'Add text' });
	return ctx;
}

function textOf(ctx: Context): string {
	const node = ctx.document.get('t');
	if (!node || node.type !== 'TEXT') throw new Error('no text');
	return plainText(node.paragraphs);
}

async function press(
	ctx: Context,
	key: string,
	modifiers: { ctrl?: boolean; shift?: boolean } = {}
): Promise<void> {
	ctx.keymap.handleKeydown({
		key,
		code: key,
		ctrlKey: modifiers.ctrl === true,
		shiftKey: modifiers.shift === true,
		altKey: false,
		metaKey: false,
		repeat: false
	} as KeyboardEvent);
	await Promise.resolve();
	await Promise.resolve();
}

describe('session', () => {
	it('starting pushes the text-edit scope and the textEditing key, stopping restores both', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		const scopesBefore = ctx.keymap.scopes.list().length;
		ctx.textEdit.start('t');
		expect(ctx.textEdit.active).toBe(true);
		expect(ctx.keymap.scopes.list().map((scope) => scope.name)).toContain('text-edit');
		expect(ctx.contextKeys.get('textEditing')).toBe(true);
		expect(ctx.selection.ids).toEqual(['t']);
		ctx.textEdit.stop();
		expect(ctx.textEdit.active).toBe(false);
		expect(ctx.keymap.scopes.list()).toHaveLength(scopesBefore);
		expect(ctx.contextKeys.get('textEditing')).toBeUndefined();
	});

	it('emits text-edit/stopped and Escape selects the node', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		const stopped: string[] = [];
		ctx.on('text-edit/stopped', (id) => stopped.push(id));
		ctx.textEdit.start('t');
		await press(ctx, 'Escape');
		expect(ctx.textEdit.active).toBe(false);
		expect(stopped).toEqual(['t']);
		expect(ctx.selection.ids).toEqual(['t']);
	});

	it('text.edit with selectAll starts with everything selected; Enter does that for a selected text', async () => {
		const ctx = await mountEditor([paragraphOf('hello'), paragraphOf('world')]);
		ctx.selection.select(['t']);
		await ctx.commands.run('text.edit', { selectAll: true });
		expect(ctx.textEdit.selection).toEqual({
			anchor: { paragraph: 0, offset: 0 },
			focus: { paragraph: 1, offset: 5 }
		});
	});

	it('selecting another node ends the session', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		ctx.selection.select(['loose']);
		expect(ctx.textEdit.active).toBe(false);
	});

	it('undoing the creation of the edited text ends the session', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		ctx.history.undo();
		expect(ctx.textEdit.active).toBe(false);
	});
});

describe('typing and undo segments', () => {
	it('typing is one undo step, a caret move starts the next', async () => {
		const ctx = await mountEditor([paragraphOf('')]);
		ctx.textEdit.start('t');
		for (const char of 'hello') ctx.textEdit.insertText(char);
		expect(textOf(ctx)).toBe('hello');
		await press(ctx, 'Home');
		for (const char of 'oh ') ctx.textEdit.insertText(char);
		expect(textOf(ctx)).toBe('oh hello');
		ctx.history.undo();
		expect(textOf(ctx)).toBe('hello');
		ctx.history.undo();
		expect(textOf(ctx)).toBe('');
		ctx.history.redo();
		expect(textOf(ctx)).toBe('hello');
	});

	it('undo inside the editor keeps the caret valid and the session running', async () => {
		const ctx = await mountEditor([paragraphOf('ab')]);
		ctx.textEdit.start('t');
		ctx.textEdit.insertText('cdefgh');
		await press(ctx, 'z', { ctrl: true });
		expect(textOf(ctx)).toBe('ab');
		expect(ctx.textEdit.active).toBe(true);
		expect(ctx.textEdit.selection.focus.offset).toBeLessThanOrEqual(2);
	});

	it('auto width follows the typing in the same undo step', async () => {
		const ctx = await mountEditor([paragraphOf('')], { textAutoResize: 'WIDTH_AND_HEIGHT' });
		ctx.textEdit.start('t');
		const empty = ctx.document.get('t');
		for (const char of 'A fairly long line of text') ctx.textEdit.insertText(char);
		const typed = ctx.document.get('t');
		expect(typed?.type === 'TEXT' && empty?.type === 'TEXT' && typed.width > empty.width + 80).toBe(
			true
		);
		ctx.history.undo();
		const back = ctx.document.get('t');
		expect(back?.type === 'TEXT' && empty?.type === 'TEXT' && back.width).toBe(
			empty?.type === 'TEXT' ? empty.width : undefined
		);
	});
});

describe('keyboard through the text-edit scope', () => {
	it('arrows, Shift+arrows, Home/End, word and document movement', async () => {
		const ctx = await mountEditor([paragraphOf('one two three')]);
		ctx.textEdit.start('t');
		await press(ctx, 'Home');
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 0, offset: 0 });
		await press(ctx, 'ArrowRight');
		await press(ctx, 'ArrowRight');
		expect(ctx.textEdit.selection.focus.offset).toBe(2);
		await press(ctx, 'ArrowRight', { ctrl: true });
		expect(ctx.textEdit.selection.focus.offset).toBe(3);
		await press(ctx, 'ArrowRight', { shift: true });
		expect(ctx.textEdit.selection).toEqual({
			anchor: { paragraph: 0, offset: 3 },
			focus: { paragraph: 0, offset: 4 }
		});
		await press(ctx, 'ArrowLeft');
		expect(ctx.textEdit.selection.focus.offset).toBe(3);
		await press(ctx, 'End');
		expect(ctx.textEdit.selection.focus.offset).toBe(13);
		await press(ctx, 'Home', { ctrl: true });
		expect(ctx.textEdit.selection.focus.offset).toBe(0);
	});

	it('Ctrl+A selects all, Backspace deletes it, Enter splits, Delete joins', async () => {
		const ctx = await mountEditor([paragraphOf('abc'), paragraphOf('def')]);
		ctx.textEdit.start('t');
		await press(ctx, 'a', { ctrl: true });
		expect(ctx.textEdit.selection.anchor).toEqual({ paragraph: 0, offset: 0 });
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 1, offset: 3 });
		await press(ctx, 'Backspace');
		expect(textOf(ctx)).toBe('');
		ctx.textEdit.insertText('xy');
		await press(ctx, 'ArrowLeft');
		await press(ctx, 'Enter');
		expect(textOf(ctx)).toBe('x\ny');
		await press(ctx, 'Backspace');
		expect(textOf(ctx)).toBe('xy');
	});

	it('Up and Down move between lines, keep the horizontal position and stop at the edges', async () => {
		const ctx = await mountEditor([paragraphOf('first line'), paragraphOf('second')]);
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 5 },
			focus: { paragraph: 0, offset: 5 }
		});
		await press(ctx, 'ArrowDown');
		expect(ctx.textEdit.selection.focus.paragraph).toBe(1);
		await press(ctx, 'ArrowDown');
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 1, offset: 6 });
		await press(ctx, 'ArrowUp');
		await press(ctx, 'ArrowUp');
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 0, offset: 0 });
	});

	it('wrapped lines: Home and End go to the visual line edges', async () => {
		const ctx = await mountEditor([paragraphOf('alpha beta gamma delta')], {
			textAutoResize: 'HEIGHT',
			width: 70
		});
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 8 },
			focus: { paragraph: 0, offset: 8 }
		});
		await press(ctx, 'Home');
		const start = ctx.textEdit.selection.focus.offset;
		expect(start).toBeGreaterThan(0);
		expect(start).toBeLessThanOrEqual(8);
		await press(ctx, 'End');
		expect(ctx.textEdit.selection.focus.offset).toBeGreaterThan(8);
		expect(ctx.textEdit.selection.focus.offset).toBeLessThan(22);
	});

	it('shortcuts of other scopes are muted while editing: a letter is not a tool key', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		const handled = ctx.keymap.handleKeydown({
			key: 'r',
			code: 'KeyR',
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			metaKey: false,
			repeat: false,
			target: document.createElement('textarea')
		} as unknown as KeyboardEvent);
		expect(handled).toBe(false);
	});
});

describe('IME composition', () => {
	it('inserts the composed text, replaces provisional text and is one undo step', async () => {
		const ctx = await mountEditor([paragraphOf('ab')]);
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 1 },
			focus: { paragraph: 0, offset: 1 }
		});
		ctx.textEdit.beginComposition();
		expect(ctx.contextKeys.get('textComposing')).toBe(true);
		ctx.textEdit.updateComposition('に');
		ctx.textEdit.updateComposition('にほ');
		ctx.textEdit.updateComposition('日本');
		expect(textOf(ctx)).toBe('a日本b');
		expect(ctx.textEdit.selection.focus.offset).toBe(3);
		ctx.textEdit.endComposition('日本語');
		expect(textOf(ctx)).toBe('a日本語b');
		expect(ctx.contextKeys.get('textComposing')).toBeUndefined();
		ctx.history.undo();
		expect(textOf(ctx)).toBe('ab');
	});

	it('editing keys do nothing while composing, so Enter and Backspace belong to the IME', async () => {
		const ctx = await mountEditor([paragraphOf('ab')]);
		ctx.textEdit.start('t');
		ctx.textEdit.beginComposition();
		ctx.textEdit.updateComposition('か');
		await press(ctx, 'Backspace');
		await press(ctx, 'Enter');
		expect(textOf(ctx)).toBe('abか');
		ctx.textEdit.endComposition('か');
		expect(textOf(ctx)).toBe('abか');
	});

	it('a cancelled composition removes its provisional text', async () => {
		const ctx = await mountEditor([paragraphOf('ab')]);
		ctx.textEdit.start('t');
		ctx.textEdit.beginComposition();
		ctx.textEdit.updateComposition('x');
		ctx.textEdit.endComposition('');
		expect(textOf(ctx)).toBe('ab');
	});

	it('composing over a selection replaces it', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t', { selectAll: true });
		ctx.textEdit.beginComposition();
		ctx.textEdit.updateComposition('こ');
		ctx.textEdit.endComposition('こんにちは');
		expect(textOf(ctx)).toBe('こんにちは');
	});
});

describe('clipboard', () => {
	it('copies plain and rich text, pastes the rich payload with its styles', async () => {
		const bold = { fontWeight: 700 };
		const ctx = await mountEditor([
			{
				...paragraphOf(''),
				runs: [
					{ text: 'plain ', style: {} },
					{ text: 'bold', style: bold }
				]
			}
		]);
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 6 },
			focus: { paragraph: 0, offset: 10 }
		});
		const payload = ctx.textEdit.copyPayload();
		expect(payload?.text).toBe('bold');
		await press(ctx, 'End');
		ctx.textEdit.paste(payload ?? { text: '' });
		const node = ctx.document.get('t');
		expect(node?.type === 'TEXT' && node.paragraphs[0].runs.map((run) => run.text)).toEqual([
			'plain ',
			'boldbold'
		]);
	});

	it('cut removes the selection and returns it; plain paste inserts at the caret', async () => {
		const ctx = await mountEditor([paragraphOf('hello world')]);
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 0 },
			focus: { paragraph: 0, offset: 6 }
		});
		expect(ctx.textEdit.cutPayload()?.text).toBe('hello ');
		expect(textOf(ctx)).toBe('world');
		ctx.textEdit.paste({ text: 'big\nnew ' });
		expect(textOf(ctx)).toBe('big\nnew world');
	});

	it('copy with nothing selected has nothing to copy', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		expect(ctx.textEdit.copyPayload()).toBeNull();
	});
});

describe('pointer', () => {
	it('places the caret at a world point, selects words and paragraphs on multi click, extends with Shift', async () => {
		const ctx = await mountEditor([paragraphOf('hello world')]);
		ctx.textEdit.start('t');
		const caret = ctx.textLayout.caretRect('t', { paragraph: 0, offset: 8 });
		const point = { x: caret.x + 0.5, y: caret.y + 3 };
		ctx.textEdit.pointerAt(point, { extend: false, clicks: 1 });
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 0, offset: 8 });
		ctx.textEdit.pointerAt(point, { extend: false, clicks: 2 });
		expect(ctx.textEdit.selection).toEqual({
			anchor: { paragraph: 0, offset: 6 },
			focus: { paragraph: 0, offset: 11 }
		});
		ctx.textEdit.pointerAt(point, { extend: false, clicks: 3 });
		expect(ctx.textEdit.selection.anchor.offset).toBe(0);
		ctx.textEdit.pointerAt({ x: 1, y: 3 }, { extend: false, clicks: 1 });
		ctx.textEdit.pointerAt(point, { extend: true, clicks: 1 });
		expect(ctx.textEdit.selection).toEqual({
			anchor: { paragraph: 0, offset: 0 },
			focus: { paragraph: 0, offset: 8 }
		});
	});

	it('knows whether a world point lies on the edited text', async () => {
		const ctx = await mountEditor([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		expect(ctx.textEdit.containsWorldPoint({ x: 2, y: 2 })).toBe(true);
		expect(ctx.textEdit.containsWorldPoint({ x: 900, y: 900 })).toBe(false);
	});

	it('text.edit with a point puts the caret there', async () => {
		const ctx = await mountEditor([paragraphOf('hello world')]);
		const caret = ctx.textLayout.caretRect('t', { paragraph: 0, offset: 6 });
		await ctx.commands.run('text.edit', { id: 't', point: { x: caret.x + 0.5, y: caret.y + 3 } });
		expect(ctx.textEdit.selection.focus).toEqual({ paragraph: 0, offset: 6 });
	});
});

describe('the editor layer', () => {
	it('renders the hidden input, caret and selection while editing and removes them after', async () => {
		const ctx = await mountEditor([paragraphOf('hello world')]);
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'canvas-overlay' } });
		flushSync();
		expect(target.querySelector('[data-text-input]')).toBeNull();

		ctx.textEdit.start('t', { selectAll: true });
		flushSync();
		expect(target.querySelector('textarea[data-text-input]')).not.toBeNull();
		expect(target.querySelector('[data-text-caret]')).not.toBeNull();
		expect(target.querySelectorAll('[data-text-selection]').length).toBeGreaterThan(0);

		ctx.textEdit.stop();
		flushSync();
		expect(target.querySelector('[data-text-input]')).toBeNull();
		expect(target.querySelector('[data-text-caret]')).toBeNull();
	});

	it('typing events on the hidden input reach the document', async () => {
		const ctx = await mountEditor([paragraphOf('')]);
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx, region: 'canvas-overlay' } });
		ctx.textEdit.start('t');
		flushSync();
		const input = target.querySelector('textarea');
		if (!input) throw new Error('no input');
		const event = new InputEvent('beforeinput', {
			inputType: 'insertText',
			data: 'Hi',
			cancelable: true,
			bubbles: true
		});
		input.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(textOf(ctx)).toBe('Hi');
		const composition = (type: string, data: string): void => {
			const compositionEvent = new CompositionEvent(type, { bubbles: true });
			Object.defineProperty(compositionEvent, 'data', { value: data });
			input.dispatchEvent(compositionEvent);
		};
		composition('compositionstart', '');
		composition('compositionupdate', 'に');
		composition('compositionend', 'に');
		expect(textOf(ctx)).toBe('Hiに');
	});
});
