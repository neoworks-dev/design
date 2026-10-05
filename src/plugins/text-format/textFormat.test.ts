import type { Context } from '@neoworks/extension-system';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MIXED } from '../../lib/document/text';
import type { Paragraph, TextNode } from '../../lib/document/types';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { CanvasKit } from '../../lib/renderer/canvaskit';
import { paragraphOf } from '../../lib/text/testing';
import textEdit from '../text-edit';
import {
	loadTestKit,
	mountWithText,
	textEditProviders
} from '../text-edit/fixtures/textEditFixture';
import textFormat from './index';

let kit: CanvasKit;

beforeAll(async () => {
	kit = await loadTestKit();
});

describePlugin('text-format', textFormat, {
	get providers() {
		return [...textEditProviders(kit, []), textEdit];
	},
	contributes: ({ ctx }) => {
		for (const id of [
			'text.bold',
			'text.italic',
			'text.underline',
			'text.link',
			'text.list.ordered'
		]) {
			expect(ctx.commands.has(id)).toBe(true);
		}
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+b');
		expect(chords).toContain('ctrl+shift+7');
		expect(chords).toContain('ctrl+alt+l');
		expect(chords).toContain('ctrl+shift+.');
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountText(paragraphs: Paragraph[], props: Partial<TextNode> = {}): Promise<Context> {
	mounted = await mountWithText(textFormat, kit, paragraphs, props, [textEdit]);
	return mounted.ctx;
}

function nodeOf(ctx: Context): TextNode {
	const node = ctx.document.get('t');
	if (!node || node.type !== 'TEXT') throw new Error('no text');
	return node;
}

function runs(ctx: Context, index = 0): [string, Record<string, unknown>][] {
	return nodeOf(ctx).paragraphs[index].runs.map((run) => [run.text, run.style]);
}

async function press(
	ctx: Context,
	code: string,
	modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): Promise<void> {
	ctx.keymap.handleKeydown({
		key: code,
		code,
		ctrlKey: modifiers.ctrl === true,
		shiftKey: modifiers.shift === true,
		altKey: modifiers.alt === true,
		metaKey: false,
		repeat: false
	} as KeyboardEvent);
	await Promise.resolve();
	await Promise.resolve();
}

function select(ctx: Context, from: number, to: number, paragraph = 0): void {
	ctx.textEdit.setSelection({
		anchor: { paragraph, offset: from },
		focus: { paragraph, offset: to }
	});
}

const BOLD = { fontWeight: 700, fontName: { family: 'Geist', style: 'Bold' } };

describe('while editing: the selected range', () => {
	it('Ctrl+B bolds the selection, splitting the run; again turns it off and merges', async () => {
		const ctx = await mountText([paragraphOf('hello world')]);
		ctx.textEdit.start('t');
		select(ctx, 3, 8);
		await press(ctx, 'b', { ctrl: true });
		expect(runs(ctx)).toEqual([
			['hel', {}],
			['lo wo', BOLD],
			['rld', {}]
		]);
		await press(ctx, 'b', { ctrl: true });
		expect(runs(ctx)).toEqual([['hello world', {}]]);
	});

	it('Ctrl+I italic, Ctrl+U underline, Ctrl+Shift+X strikethrough', async () => {
		const ctx = await mountText([paragraphOf('abcdef')]);
		ctx.textEdit.start('t');
		select(ctx, 0, 3);
		await press(ctx, 'i', { ctrl: true });
		expect(runs(ctx)[0][1]).toEqual({ fontName: { family: 'Geist', style: 'Italic' } });
		await press(ctx, 'i', { ctrl: true });
		await press(ctx, 'u', { ctrl: true });
		expect(runs(ctx)[0][1]).toEqual({ textDecoration: 'UNDERLINE' });
		await press(ctx, 'x', { ctrl: true, shift: true });
		expect(runs(ctx)[0][1]).toEqual({ textDecoration: 'STRIKETHROUGH' });
		await press(ctx, 'x', { ctrl: true, shift: true });
		expect(runs(ctx)).toEqual([['abcdef', {}]]);
	});

	it('formatting is one undo step and keeps the selection', async () => {
		const ctx = await mountText([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		select(ctx, 1, 4);
		await press(ctx, 'b', { ctrl: true });
		expect(ctx.textEdit.selection.focus.offset).toBe(4);
		ctx.history.undo();
		expect(runs(ctx)).toEqual([['hello', {}]]);
	});

	it('repeated size steps coalesce into one undo step', async () => {
		const ctx = await mountText([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		select(ctx, 0, 5);
		await press(ctx, 'Period', { ctrl: true, shift: true });
		await press(ctx, 'Period', { ctrl: true, shift: true });
		await press(ctx, 'Period', { ctrl: true, shift: true });
		expect(runs(ctx)[0][1]).toEqual({ fontSize: 19 });
		await press(ctx, 'Comma', { ctrl: true, shift: true });
		expect(runs(ctx)[0][1]).toEqual({ fontSize: 18 });
		ctx.history.undo();
		expect(runs(ctx)).toEqual([['hello', {}]]);
	});

	it('weight, line height and letter spacing step', async () => {
		const ctx = await mountText([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		select(ctx, 0, 5);
		await press(ctx, 'Period', { ctrl: true, alt: true });
		expect(runs(ctx)[0][1]).toEqual({
			fontWeight: 500,
			fontName: { family: 'Geist', style: 'Medium' }
		});
		await press(ctx, 'Period', { alt: true, shift: true });
		expect(runs(ctx)[0][1].lineHeight).toEqual({ value: 20, unit: 'PIXELS' });
		await press(ctx, 'Period', { alt: true });
		expect(runs(ctx)[0][1].letterSpacing).toEqual({ value: 1, unit: 'PERCENT' });
	});

	it('a collapsed caret formats what is typed next', async () => {
		const ctx = await mountText([paragraphOf('ab')]);
		ctx.textEdit.start('t');
		select(ctx, 1, 1);
		await press(ctx, 'b', { ctrl: true });
		expect(runs(ctx)).toEqual([['ab', {}]]);
		ctx.textEdit.insertText('X');
		expect(runs(ctx)).toEqual([
			['a', {}],
			['X', BOLD],
			['b', {}]
		]);
		await press(ctx, 'b', { ctrl: true });
		ctx.textEdit.insertText('Y');
		expect(runs(ctx).map((run) => run[0])).toEqual(['a', 'X', 'Yb']);
	});
});

describe('paragraph formatting', () => {
	it('alignment keys set the paragraphs the selection touches', async () => {
		const ctx = await mountText([paragraphOf('one'), paragraphOf('two'), paragraphOf('three')]);
		ctx.textEdit.start('t');
		select(ctx, 1, 2, 0);
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 1 },
			focus: { paragraph: 1, offset: 1 }
		});
		await press(ctx, 't', { ctrl: true, alt: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.align)).toEqual([
			'CENTER',
			'CENTER',
			'LEFT'
		]);
		await press(ctx, 'r', { ctrl: true, alt: true });
		await press(ctx, 'j', { ctrl: true, alt: true });
		await press(ctx, 'l', { ctrl: true, alt: true });
		expect(nodeOf(ctx).paragraphs[0].align).toBe('LEFT');
	});

	it('Ctrl+Shift+8 and 7 make lists, Tab and Shift+Tab change the level', async () => {
		const ctx = await mountText([paragraphOf('first'), paragraphOf('second')]);
		ctx.textEdit.start('t');
		ctx.textEdit.setSelection({
			anchor: { paragraph: 0, offset: 0 },
			focus: { paragraph: 1, offset: 2 }
		});
		await press(ctx, 'Digit8', { ctrl: true, shift: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.list)).toEqual([
			'UNORDERED',
			'UNORDERED'
		]);
		await press(ctx, 'Tab');
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.listLevel)).toEqual([1, 1]);
		await press(ctx, 'Tab', { shift: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.listLevel)).toEqual([0, 0]);
		await press(ctx, 'Digit7', { ctrl: true, shift: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.list)).toEqual([
			'ORDERED',
			'ORDERED'
		]);
		await press(ctx, 'Digit7', { ctrl: true, shift: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.list)).toEqual(['NONE', 'NONE']);
	});

	it('Tab outside a list does nothing to the text', async () => {
		const ctx = await mountText([paragraphOf('plain')]);
		ctx.textEdit.start('t');
		await press(ctx, 'Tab');
		expect(nodeOf(ctx).paragraphs[0].runs[0].text).toBe('plain');
	});
});

describe('links', () => {
	it('Ctrl+K opens the prompt, applying sets the link on the selection, empty removes it', async () => {
		const ctx = await mountText([paragraphOf('see docs here')]);
		ctx.textEdit.start('t');
		select(ctx, 4, 8);
		await press(ctx, 'k', { ctrl: true });
		expect(ctx.textFormat.state.linkPrompt).toEqual({ url: '' });
		expect(ctx.contextKeys.get('textEditSuspended')).toBe(true);
		ctx.textFormat.closeLinkPrompt(true, ' https://example.com ');
		expect(ctx.contextKeys.get('textEditSuspended')).toBeUndefined();
		expect(runs(ctx)[1]).toEqual([
			'docs',
			{ hyperlink: { type: 'URL', value: 'https://example.com' } }
		]);
		expect(ctx.textFormat.hasLink()).toBe(true);

		await press(ctx, 'k', { ctrl: true });
		expect(ctx.textFormat.state.linkPrompt).toEqual({ url: 'https://example.com' });
		ctx.textFormat.closeLinkPrompt(true, '');
		expect(runs(ctx)).toEqual([['see docs here', {}]]);
	});

	it('editing keys are muted while the prompt is open and Escape cancels it', async () => {
		const ctx = await mountText([paragraphOf('hello')]);
		ctx.textEdit.start('t');
		select(ctx, 0, 5);
		ctx.textFormat.openLinkPrompt();
		await press(ctx, 'Backspace');
		expect(nodeOf(ctx).paragraphs[0].runs[0].text).toBe('hello');
		ctx.textFormat.closeLinkPrompt(false);
		expect(runs(ctx)).toEqual([['hello', {}]]);
		expect(ctx.textEdit.active).toBe(true);
	});
});

describe('not editing: the whole node', () => {
	it('with a text node selected, Ctrl+B bolds it as a whole and one undo restores it', async () => {
		const ctx = await mountText([paragraphOf('hello'), paragraphOf('world')]);
		ctx.selection.select(['t']);
		await press(ctx, 'b', { ctrl: true });
		expect(nodeOf(ctx).defaultStyle.fontWeight).toBe(700);
		expect(nodeOf(ctx).defaultStyle.fontName.style).toBe('Bold');
		await press(ctx, 'b', { ctrl: true });
		expect(nodeOf(ctx).defaultStyle.fontWeight).toBe(400);
		ctx.history.undo();
		expect(nodeOf(ctx).defaultStyle.fontWeight).toBe(700);
	});

	it('size steps change the default style and the runs that set their own size', async () => {
		const ctx = await mountText([
			{
				...paragraphOf(''),
				runs: [
					{ text: 'a', style: {} },
					{ text: 'b', style: { fontSize: 24 } }
				]
			}
		]);
		ctx.selection.select(['t']);
		await press(ctx, 'Period', { ctrl: true, shift: true });
		expect(nodeOf(ctx).defaultStyle.fontSize).toBe(17);
		expect(runs(ctx)).toEqual([
			['a', {}],
			['b', { fontSize: 25 }]
		]);
	});

	it('alignment and lists apply to every paragraph', async () => {
		const ctx = await mountText([paragraphOf('a'), paragraphOf('b')]);
		ctx.selection.select(['t']);
		await press(ctx, 'r', { ctrl: true, alt: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.align)).toEqual(['RIGHT', 'RIGHT']);
		await press(ctx, 'Digit8', { ctrl: true, shift: true });
		expect(nodeOf(ctx).paragraphs.map((paragraph) => paragraph.list)).toEqual([
			'UNORDERED',
			'UNORDERED'
		]);
	});

	it('shortcuts do nothing without a selected text, and a text edit is untouched by other kinds', async () => {
		const ctx = await mountText([paragraphOf('hello')]);
		ctx.selection.select(['loose']);
		await press(ctx, 'b', { ctrl: true });
		expect(nodeOf(ctx).defaultStyle.fontWeight).toBe(400);
	});
});

describe('reporting to the typography section', () => {
	it('style() reports MIXED for a range with differing sizes and the common value otherwise', async () => {
		const ctx = await mountText([paragraphOf('abcdef')]);
		ctx.textEdit.start('t');
		select(ctx, 0, 3);
		await press(ctx, 'Period', { ctrl: true, shift: true });
		select(ctx, 0, 6);
		expect(ctx.textFormat.style().fontSize).toBe(MIXED);
		expect(ctx.textFormat.style().fontName).toEqual({ family: 'Geist', style: 'Regular' });
		select(ctx, 0, 3);
		expect(ctx.textFormat.style().fontSize).toBe(17);
	});

	it('across several selected nodes, differing properties are MIXED', async () => {
		const ctx = await mountText([paragraphOf('one')]);
		const copy = { ...nodeOf(ctx), id: 'u', index: 'a1' };
		ctx.document.apply(
			ctx.document.insertNode({ ...copy, defaultStyle: { ...copy.defaultStyle, fontSize: 30 } }),
			{
				origin: 'user',
				label: 'Add'
			}
		);
		ctx.selection.select(['t', 'u']);
		const style = ctx.textFormat.style();
		expect(style.fontSize).toBe(MIXED);
		expect(style.fontName).toEqual({ family: 'Geist', style: 'Regular' });
	});

	it('style() is empty when there is nothing to format', async () => {
		const ctx = await mountText([paragraphOf('x')]);
		expect(ctx.textFormat.style()).toEqual({});
		expect(ctx.textFormat.hasTarget).toBe(false);
	});
});
