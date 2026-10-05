import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { planCreateInstance, type NodeId } from '../../lib/document';
import { buildDocument, node, page, rectangle } from '../../lib/document/fixtures';
import { mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { at, autolayoutProviders } from '../autolayout/fixtures/autolayoutFixture';
import autolayout from '../autolayout';
import componentSync from '../component-sync';

// Instances of auto layout components: the main's layout result reaches its instances through
// the sync, and an instance that overrides its own layout reflows on its own.

function sample(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				node(
					'COMPONENT',
					{
						id: 'M',
						name: 'Row',
						transform: at(0, 0),
						width: 120,
						height: 40,
						layoutMode: 'HORIZONTAL',
						itemSpacing: 10,
						paddingTop: 10,
						paddingRight: 10,
						paddingBottom: 10,
						paddingLeft: 10,
						primaryAxisSizingMode: 'FIXED',
						counterAxisSizingMode: 'FIXED'
					},
					[
						rectangle({ id: 'a', name: 'a', transform: at(0, 0), width: 20, height: 20 }),
						rectangle({ id: 'b', name: 'b', transform: at(0, 0), width: 20, height: 20 })
					]
				)
			],
			{ id: 'p0' }
		)
	]);
}

const USER = { origin: 'user', label: 'test' } as const;

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(autolayout, {
		providers: [...autolayoutProviders(sample()), componentSync]
	});
	// The fixture document is stored unlaid-out; the first change to the main lays it out.
	const { ctx } = mounted;
	ctx.document.apply(ctx.document.setProps('M', { itemSpacing: 11 }), USER);
	ctx.document.apply(ctx.document.setProps('M', { itemSpacing: 10 }), USER);
	return ctx;
}

function xOf(ctx: Context, id: NodeId): number {
	const found = ctx.document.require(id);
	if (found.type === 'PAGE') throw new Error('page');
	return found.transform[0][2];
}

function copyOf(ctx: Context, instanceId: NodeId, ref: NodeId): NodeId {
	const copy = ctx.document.childNodes(instanceId).find((child) => child.componentRef === ref);
	if (copy === undefined) throw new Error(`no copy of ${ref}`);
	return copy.id;
}

describe('instances of auto layout components', () => {
	it('lays the main out and gives the instance the same layout', async () => {
		const ctx = await open();
		const plan = planCreateInstance(ctx.document.reader, 'M');
		ctx.document.apply(plan.changes, USER);
		const instanceId = plan.rootId;
		expect(xOf(ctx, 'b')).toBe(xOf(ctx, copyOf(ctx, instanceId, 'b')));
	});

	it('a main spacing change reflows the main and reaches the instance in one undo step', async () => {
		const ctx = await open();
		const plan = planCreateInstance(ctx.document.reader, 'M');
		ctx.document.apply(plan.changes, USER);
		const instanceId = plan.rootId;
		const copyB = copyOf(ctx, instanceId, 'b');
		const before = xOf(ctx, copyB);

		ctx.document.apply(ctx.document.setProps('M', { itemSpacing: 30 }), USER);
		const gap = xOf(ctx, 'b') - xOf(ctx, 'a');
		expect(gap).toBe(50);
		expect(xOf(ctx, copyB) - xOf(ctx, copyOf(ctx, instanceId, 'a'))).toBe(gap);
		expect(Reflect.get(ctx.document.require(instanceId), 'itemSpacing')).toBe(30);

		ctx.history.undo();
		expect(xOf(ctx, copyB)).toBe(before);
		expect(xOf(ctx, 'b') - xOf(ctx, 'a')).toBe(30);
	});

	it('an instance that overrides its spacing reflows alone and ignores the main afterwards', async () => {
		const ctx = await open();
		const plan = planCreateInstance(ctx.document.reader, 'M');
		ctx.document.apply(plan.changes, USER);
		const instanceId = plan.rootId;
		ctx.document.apply(ctx.document.setProps(instanceId, { itemSpacing: 40 }), USER);
		const gapOfInstance =
			xOf(ctx, copyOf(ctx, instanceId, 'b')) - xOf(ctx, copyOf(ctx, instanceId, 'a'));
		expect(gapOfInstance).toBe(60);
		expect(ctx.document.require(instanceId).touched).toContain('auto-layout');
		expect(xOf(ctx, 'b') - xOf(ctx, 'a')).toBe(30);

		ctx.document.apply(ctx.document.setProps('M', { itemSpacing: 20 }), USER);
		expect(Reflect.get(ctx.document.require(instanceId), 'itemSpacing')).toBe(40);
		expect(xOf(ctx, copyOf(ctx, instanceId, 'b')) - xOf(ctx, copyOf(ctx, instanceId, 'a'))).toBe(
			60
		);
	});
});
