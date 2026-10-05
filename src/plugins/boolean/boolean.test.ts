import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { parseNode, type DesignDocument } from '../../lib/document';
import { buildDocument, page, rectangle } from '../../lib/document/fixtures';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import canvaskit from '../canvaskit';
import boolean from './index';

function squares(): DesignDocument {
	return buildDocument([
		page(
			'Page',
			[
				rectangle({
					id: 'a',
					transform: [
						[1, 0, 100],
						[0, 1, 100]
					],
					width: 60,
					height: 60
				}),
				rectangle({
					id: 'b',
					transform: [
						[1, 0, 130],
						[0, 1, 130]
					],
					width: 60,
					height: 60
				})
			],
			{ id: 'p' }
		)
	]);
}

function providers(): Plugin[] {
	const kit = {
		name: 'canvaskit',
		inject: [],
		async apply(ctx: Context): Promise<void> {
			await canvaskit.apply(ctx, { locateFile: nodeWasmLocator() });
		}
	};
	return [...editingProviders(squares()), kit as Plugin];
}

describePlugin('boolean', boolean, {
	providers: providers(),
	contributes: ({ ctx }) => {
		for (const id of ['union', 'subtract', 'intersect', 'exclude']) {
			expect(ctx.commands.has(`boolean.${id}`)).toBe(true);
			expect(ctx.commands.has(`boolean.${id}-flatten`)).toBe(true);
		}
		expect(ctx.commands.has('boolean.flatten')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+alt+u');
		expect(ctx.menus.has('context/canvas')).toBe(true);
		expect(ctx.menus.has('context/layer')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountBoolean(): Promise<Context> {
	mounted = await mountPlugin(boolean, { providers: providers() });
	return mounted.ctx;
}

async function run(ctx: Context, command: string): Promise<void> {
	await ctx.commands.run(command);
}

function booleanNodes(ctx: Context): ReturnType<Context['document']['query']> {
	return ctx.document.query((node) => node.type === 'BOOLEAN_OPERATION');
}

function vectorNodes(ctx: Context): ReturnType<Context['document']['query']> {
	return ctx.document.query((node) => node.type === 'VECTOR');
}

describe('combine', () => {
	it('wraps the selection in a live boolean node that keeps its operands', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.subtract');
		const [node] = booleanNodes(ctx);
		expect(node).toMatchObject({ type: 'BOOLEAN_OPERATION', booleanOperation: 'SUBTRACT' });
		expect(node.name).toBe('Subtract');
		expect(ctx.document.children(node.id)).toEqual(['a', 'b']);
		expect(ctx.selection.ids).toEqual([node.id]);
		expect(ctx.document.absoluteBounds(node.id)).toMatchObject({
			x: 100,
			y: 100,
			width: 90,
			height: 90
		});
		expect(ctx.document.absoluteBounds('b')).toMatchObject({ x: 130, y: 130 });
		expect(parseNode(node).ok).toBe(true);
	});

	it('is one undo step that puts the operands back', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.union');
		expect(ctx.history.undo()).toBe(true);
		expect(booleanNodes(ctx)).toHaveLength(0);
		expect(ctx.document.require('a').parentId).toBe('p');
		expect(ctx.document.require('b').parentId).toBe('p');
		expect(ctx.document.absoluteBounds('b')).toMatchObject({ x: 130, y: 130 });
	});

	it('each command sets its operation', async () => {
		for (const [command, operation] of [
			['union', 'UNION'],
			['subtract', 'SUBTRACT'],
			['intersect', 'INTERSECT'],
			['exclude', 'EXCLUDE']
		]) {
			const ctx = await mountBoolean();
			ctx.selection.select(['a', 'b']);
			await run(ctx, `boolean.${command}`);
			expect(booleanNodes(ctx)[0]).toMatchObject({ booleanOperation: operation });
			await mounted?.cleanup();
			mounted = undefined;
		}
	});

	it('needs two operands', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a']);
		await run(ctx, 'boolean.union');
		expect(booleanNodes(ctx)).toHaveLength(0);
	});

	it('applied to a boolean node it changes the operation (and the default name)', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.union');
		await run(ctx, 'boolean.intersect');
		const [node] = booleanNodes(ctx);
		expect(node).toMatchObject({ booleanOperation: 'INTERSECT', name: 'Intersect' });
		expect(ctx.history.undo()).toBe(true);
		expect(booleanNodes(ctx)[0]).toMatchObject({ booleanOperation: 'UNION' });
	});
});

describe('flatten', () => {
	it('Alt variant applies and flattens in one undo step', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.intersect-flatten');
		expect(booleanNodes(ctx)).toHaveLength(0);
		const [vector] = vectorNodes(ctx);
		if (vector.type !== 'VECTOR') throw new Error('no vector');
		expect(vector.name).toBe('Intersect');
		expect(ctx.document.has('a')).toBe(false);
		expect(ctx.document.absoluteBounds(vector.id)).toMatchObject({
			x: 130,
			y: 130,
			width: 30,
			height: 30
		});
		expect(vector.network.vertices).toHaveLength(4);
		expect(vector.network.regions).toHaveLength(1);
		expect(parseNode(vector).ok).toBe(true);
		expect(ctx.selection.ids).toEqual([vector.id]);
		expect(ctx.history.undo()).toBe(true);
		expect(vectorNodes(ctx)).toHaveLength(0);
		expect(booleanNodes(ctx)).toHaveLength(0);
		expect(ctx.document.has('a')).toBe(true);
		expect(ctx.document.has('b')).toBe(true);
	});

	it('flattens a subtraction into the L shape', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.subtract-flatten');
		const [vector] = vectorNodes(ctx);
		if (vector.type !== 'VECTOR') throw new Error('no vector');
		expect(vector.network.vertices).toHaveLength(6);
		expect(ctx.document.absoluteBounds(vector.id)).toMatchObject({
			x: 100,
			y: 100,
			width: 60,
			height: 60
		});
	});

	it('Flatten turns a selected boolean into a vector; editing an operand first changes the result', async () => {
		const ctx = await mountBoolean();
		ctx.selection.select(['a', 'b']);
		await run(ctx, 'boolean.union');
		const [node] = booleanNodes(ctx);
		const moved = ctx.document.setProps('b', {
			transform: [
				[1, 0, 70],
				[0, 1, 70]
			]
		});
		ctx.document.apply(moved, { origin: 'user', label: 'Move operand' });
		ctx.selection.select([node.id]);
		await run(ctx, 'boolean.flatten');
		const [vector] = vectorNodes(ctx);
		if (vector.type !== 'VECTOR') throw new Error('no vector');
		expect(ctx.document.absoluteBounds(vector.id)).toMatchObject({ width: 130, height: 130 });
		if (node.type !== 'BOOLEAN_OPERATION') throw new Error('no boolean');
		expect(vector.fills).toEqual(node.fills);
	});
});
