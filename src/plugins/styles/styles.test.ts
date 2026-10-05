import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, text } from '../../lib/document/fixtures';
import type { Effect, LayoutGrid, Node, Paint } from '../../lib/document';
import { at, box, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { solidPaint } from '../../lib/editing/paints';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import variablesCore from '../variables-core';
import styles from './index';

const RED = solidPaint({ r: 1, g: 0, b: 0 });
const BLUE = solidPaint({ r: 0, g: 0, b: 1 });

function sample(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'f', transform: at(0, 0), width: 300, height: 300 }, [
					box('a', 0, 0),
					box('b', 20, 20),
					text({ id: 't', transform: at(0, 100), width: 100, height: 20 })
				])
			],
			{ id: 'p' }
		)
	]);
}

function providers(): ReturnType<typeof editingProviders> {
	return [...editingProviders(sample()), variablesCore];
}

describePlugin('styles', styles, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.styles).toBeDefined();
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(styles, { providers: providers() });
	return mounted.ctx;
}

function setFills(ctx: Context, id: string, fills: Paint[]): void {
	ctx.document.apply(ctx.document.setProps(id, { fills }), { origin: 'user', label: 'Setup' });
}

function fillsOf(node: Node): Paint[] {
	if (!('fills' in node)) throw new Error('no fills');
	return node.fills;
}

function resolvedFills(ctx: Context, id: string): Paint[] {
	return fillsOf(ctx.variables.resolvedNode(id));
}

describe('paint styles', () => {
	it('creates a style from the fills of a node and applies it', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		const id = ctx.styles.create('fill', ['a'], 'Brand/Red');
		expect(ctx.styles.list('PAINT').map((style) => style.name)).toEqual(['Brand/Red']);
		expect(ctx.document.require('a')).toMatchObject({ fillStyleId: id });
		expect(ctx.styles.sharedStyleId(['a'], 'fill')).toBe(id);
	});

	it('editing a style updates every consumer, in one undo step', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		const id = ctx.styles.create('fill', ['a'], 'Red');
		ctx.styles.apply('fill', id, ['b']);
		const steps = ctx.history.entries.length;

		ctx.styles.setValue(id, [BLUE]);
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
		expect(resolvedFills(ctx, 'b')).toEqual([BLUE]);
		expect(fillsOf(ctx.document.require('b'))).toEqual([BLUE]);
		expect(ctx.history.entries).toHaveLength(steps + 1);

		ctx.history.undo();
		expect(resolvedFills(ctx, 'a')).toEqual([RED]);
		expect(resolvedFills(ctx, 'b')).toEqual([RED]);
		ctx.history.redo();
		expect(resolvedFills(ctx, 'b')).toEqual([BLUE]);
	});

	it('readers see the style even when only the style entity changes', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		const id = ctx.styles.create('fill', ['a'], 'Red');
		ctx.document.apply(ctx.document.setEntityProps('style', id, { value: [BLUE] }), {
			origin: 'user',
			label: 'Direct edit',
			replay: 'redo'
		});
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
	});

	it('detach keeps the values and drops the id', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		const id = ctx.styles.create('fill', ['a'], 'Red');
		ctx.styles.setValue(id, [BLUE]);
		ctx.styles.detach('fill', ['a']);
		expect(ctx.document.require('a')).not.toHaveProperty('fillStyleId');
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
		ctx.styles.setValue(id, [RED]);
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
	});

	it('editing the fills of a styled node detaches it', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		ctx.styles.create('fill', ['a'], 'Red');
		setFills(ctx, 'a', [BLUE]);
		expect(ctx.document.require('a')).not.toHaveProperty('fillStyleId');
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
		ctx.history.undo();
		expect(ctx.document.require('a')).toHaveProperty('fillStyleId');
		expect(resolvedFills(ctx, 'a')).toEqual([RED]);
	});

	it('deleting a style detaches its consumers and keeps their values', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		const id = ctx.styles.create('fill', ['a'], 'Red');
		ctx.styles.apply('fill', id, ['b']);
		ctx.styles.remove(id);
		expect(ctx.styles.list()).toEqual([]);
		expect(ctx.document.require('b')).not.toHaveProperty('fillStyleId');
		expect(resolvedFills(ctx, 'b')).toEqual([RED]);
		ctx.history.undo();
		expect(ctx.styles.get(id)).toBeDefined();
		expect(ctx.styles.consumerCount(id)).toBe(2);
	});

	it('redefines a style from a node and renames it', async () => {
		const ctx = await open();
		setFills(ctx, 'a', [RED]);
		setFills(ctx, 'b', [BLUE]);
		const id = ctx.styles.create('fill', ['a'], 'Red');
		ctx.styles.redefine(id, 'fill', 'b');
		ctx.styles.rename(id, 'Brand/Blue');
		expect(resolvedFills(ctx, 'a')).toEqual([BLUE]);
		expect(ctx.styles.get(id)).toMatchObject({ name: 'Brand/Blue' });
	});

	it('a stroke style paints the strokes of its consumers', async () => {
		const ctx = await open();
		const stroke = {
			paints: [RED],
			weight: 2,
			align: 'INSIDE',
			cap: 'NONE',
			join: 'MITER',
			miterLimit: 4,
			dashPattern: []
		};
		ctx.document.apply(ctx.document.setProps('a', { strokes: [stroke] }), {
			origin: 'user',
			label: 'Setup'
		});
		const id = ctx.styles.create('stroke', ['a'], 'Outline');
		ctx.styles.apply('stroke', id, ['b']);
		ctx.styles.setValue(id, [BLUE]);
		const resolved = ctx.variables.resolvedNode('b');
		if (!('strokes' in resolved)) throw new Error('no strokes');
		expect(resolved.strokes[0]).toMatchObject({ paints: [BLUE], weight: 1 });
	});
});

describe('effect, grid and text styles', () => {
	it('an effect style follows its edits', async () => {
		const ctx = await open();
		const shadow: Effect = {
			type: 'DROP_SHADOW',
			visible: true,
			blendMode: 'NORMAL',
			color: { r: 0, g: 0, b: 0, a: 0.25 },
			offset: { x: 0, y: 4 },
			radius: 4,
			spread: 0
		};
		ctx.document.apply(ctx.document.setProps('a', { effects: [shadow] }), {
			origin: 'user',
			label: 'Setup'
		});
		const id = ctx.styles.create('effect', ['a'], 'Shadow');
		ctx.styles.apply('effect', id, ['b']);
		ctx.styles.setValue(id, [{ ...shadow, radius: 20 }]);
		const resolved = ctx.variables.resolvedNode('b');
		if (!('effects' in resolved)) throw new Error('no effects');
		expect(resolved.effects).toMatchObject([{ radius: 20 }]);
	});

	it('a grid style applies to frames only', async () => {
		const ctx = await open();
		const grid: LayoutGrid = {
			pattern: 'COLUMNS',
			visible: true,
			color: { r: 1, g: 0, b: 0, a: 0.1 },
			count: 12,
			gutterSize: 16,
			alignment: 'STRETCH'
		};
		ctx.document.apply(ctx.document.setProps('f', { layoutGrids: [grid] }), {
			origin: 'user',
			label: 'Setup'
		});
		const id = ctx.styles.create('grid', ['f'], 'Columns');
		ctx.styles.apply('grid', id, ['a']);
		expect(ctx.document.require('a')).not.toHaveProperty('gridStyleId');
		expect(ctx.document.require('f')).toMatchObject({ gridStyleId: id });
		ctx.styles.setValue(id, [{ ...grid, count: 4 }]);
		const resolved = ctx.variables.resolvedNode('f');
		if (!('layoutGrids' in resolved)) throw new Error('no grids');
		expect(resolved.layoutGrids).toMatchObject([{ count: 4 }]);
	});

	it('a text style sets the font of a text node and detaches on a font edit', async () => {
		const ctx = await open();
		const node = ctx.document.require('t');
		if (node.type !== 'TEXT') throw new Error('not text');
		const id = ctx.styles.create('text', ['t'], 'Body');
		ctx.styles.setValue(id, { fontSize: 32, fontWeight: 700 });
		const resolved = ctx.variables.resolvedNode('t');
		if (resolved.type !== 'TEXT') throw new Error('not text');
		expect(resolved.defaultStyle).toMatchObject({ fontSize: 32, fontWeight: 700, textStyleId: id });

		ctx.document.apply(
			ctx.document.setProps('t', {
				defaultStyle: { ...resolved.defaultStyle, fontSize: 18 }
			}),
			{ origin: 'user', label: 'Edit' }
		);
		const edited = ctx.document.require('t');
		if (edited.type !== 'TEXT') throw new Error('not text');
		expect(edited.defaultStyle).not.toHaveProperty('textStyleId');
		expect(edited.defaultStyle.fontSize).toBe(18);
	});

	it('refuses to create a style from nothing', async () => {
		const ctx = await open();
		expect(() => ctx.styles.create('grid', ['a'], 'No grid')).toThrow();
	});
});
