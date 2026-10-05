import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import {
	planCreateInstance,
	type DesignDocument,
	type InstanceNode,
	type Node,
	type NodeId
} from '../../lib/document';
import { buildDocument, frame, node, page, rectangle } from '../../lib/document/fixtures';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { solidPaint } from '../../lib/editing/paints';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { fakeOverlay } from '../../lib/selecting/fixtures/selectionFixture';
import { assetsProviders } from '../assets-panel/fixtures/assetsFixture';
import components from './index';

const RED = solidPaint({ r: 1, g: 0, b: 0 });
const BLUE = solidPaint({ r: 0, g: 0, b: 1 });
const GREEN = solidPaint({ r: 0, g: 1, b: 0 });

function swapDocument(): DesignDocument {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'f', name: 'Host', transform: at(0, 0), width: 600, height: 600 }),
				node('COMPONENT', { id: 'm-a', name: 'A', transform: at(700, 0), width: 100, height: 40 }, [
					rectangle({ id: 'm-a-label', name: 'label', width: 100, height: 20, fills: [RED] }),
					rectangle({ id: 'm-a-only', name: 'only in A', width: 10, height: 10 })
				]),
				node(
					'COMPONENT',
					{ id: 'm-b', name: 'B', transform: at(700, 100), width: 160, height: 60 },
					[
						rectangle({ id: 'm-b-label', name: 'label', width: 160, height: 20, fills: [BLUE] }),
						rectangle({ id: 'm-b-extra', name: 'extra', width: 10, height: 10 })
					]
				)
			],
			{ id: 'p' }
		)
	]);
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(components, {
		providers: [...assetsProviders({ document: swapDocument() }), fakeOverlay]
	});
	return mounted.ctx;
}

function childNamed(ctx: Context, parentId: NodeId, name: string): Node {
	const found = ctx.document.childNodes(parentId).find((child) => child.name === name);
	if (found === undefined) throw new Error(`no layer ${name}`);
	return found;
}

function instanceOfA(ctx: Context): InstanceNode {
	const plan = planCreateInstance(ctx.document.reader, 'm-a', { parentId: 'f', index: 'a0' });
	ctx.document.apply(plan.changes, { origin: 'user', label: 'Create instance' });
	const instance = ctx.document.require(plan.rootId);
	if (instance.type !== 'INSTANCE') throw new Error('not an instance');
	return instance;
}

describe('swap instance', () => {
	it('keeps the id and place, carries matching overrides and drops unmatched ones', async () => {
		const ctx = await open();
		const instance = instanceOfA(ctx);
		ctx.document.apply(
			ctx.document.setProps(childNamed(ctx, instance.id, 'label').id, { fills: [GREEN] }),
			{
				origin: 'user',
				label: 'Override'
			}
		);
		ctx.document.apply(
			ctx.document.setProps(childNamed(ctx, instance.id, 'only in A').id, { opacity: 0.5 }),
			{
				origin: 'user',
				label: 'Override'
			}
		);

		await ctx.commands.run('components.swap', { mainId: 'm-b', instanceId: instance.id });

		const swapped = ctx.document.require(instance.id);
		expect(swapped).toMatchObject({ type: 'INSTANCE', mainComponentId: 'm-b', parentId: 'f' });
		expect(ctx.document.childNodes(instance.id).map((child) => child.name)).toEqual([
			'label',
			'extra'
		]);
		const label = childNamed(ctx, instance.id, 'label');
		expect(label).toMatchObject({ fills: [GREEN] });
		expect(label.touched).toContain('fills');
		expect(childNamed(ctx, instance.id, 'extra').touched ?? []).toEqual([]);
		expect(ctx.selection.ids).toEqual([instance.id]);
	});

	it('is one undo step that brings the old subtree back with its override', async () => {
		const ctx = await open();
		const instance = instanceOfA(ctx);
		ctx.document.apply(
			ctx.document.setProps(childNamed(ctx, instance.id, 'label').id, { fills: [GREEN] }),
			{
				origin: 'user',
				label: 'Override'
			}
		);
		const steps = ctx.history.entries.length;
		await ctx.commands.run('components.swap', { mainId: 'm-b', instanceId: instance.id });
		expect(ctx.history.entries).toHaveLength(steps + 1);
		ctx.history.undo();
		expect(ctx.document.require(instance.id)).toMatchObject({ mainComponentId: 'm-a' });
		expect(childNamed(ctx, instance.id, 'label')).toMatchObject({ fills: [GREEN] });
		expect(ctx.document.childNodes(instance.id).map((child) => child.name)).toEqual([
			'label',
			'only in A'
		]);
	});

	it('swaps the selected instance when the command has no instance id', async () => {
		const ctx = await open();
		const instance = instanceOfA(ctx);
		ctx.selection.select([childNamed(ctx, instance.id, 'label').id]);
		await ctx.commands.run('components.swap', { mainId: 'm-b' });
		expect(ctx.document.require(instance.id)).toMatchObject({ mainComponentId: 'm-b' });
	});

	it('does nothing for the same component and for a layer outside any instance', async () => {
		const ctx = await open();
		const instance = instanceOfA(ctx);
		const steps = ctx.history.entries.length;
		await ctx.commands.run('components.swap', { mainId: 'm-a', instanceId: instance.id });
		await ctx.commands.run('components.swap', { mainId: 'm-b', instanceId: 'm-a-label' });
		expect(ctx.history.entries).toHaveLength(steps);
	});
});
