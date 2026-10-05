import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { planCreateInstance, planDetach } from '../../lib/document';
import { storeWithMain } from '../../lib/document/componentHarness';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import componentSync from './index';

const USER = { origin: 'user', label: 'test' } as const;

function providers(): ReturnType<typeof editingProviders> {
	return editingProviders(storeWithMain().document);
}

describePlugin('component-sync', componentSync, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.componentSync).toBeDefined();
		expect(ctx.componentSync.components().map((component) => component.id)).toEqual(['M']);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountSync(): Promise<Context> {
	mounted = await mountPlugin(componentSync, { providers: providers() });
	return mounted.ctx;
}

function createInstance(ctx: Context): string {
	const plan = planCreateInstance(ctx.document.reader, 'M');
	ctx.document.apply(plan.changes, USER);
	return plan.rootId;
}

function childWidth(ctx: Context, instanceId: string): unknown {
	const copy = ctx.document.childNodes(instanceId).find((node) => node.componentRef === 'bg');
	if (copy === undefined) throw new Error('no copy');
	return Reflect.get(copy, 'width');
}

describe('component sync through document.apply', () => {
	it('answers component queries', async () => {
		const ctx = await mountSync();
		const instance = createInstance(ctx);
		expect(ctx.componentSync.mainOf(instance)?.id).toBe('M');
		expect(ctx.componentSync.instancesOf('M').map((node) => node.id)).toEqual([instance]);
		expect(ctx.componentSync.isInsideInstance(instance)).toBe(true);
		expect(ctx.componentSync.isInsideInstance('M')).toBe(false);
	});

	it('syncs a main edit into the same transaction and undoes it in one step', async () => {
		const ctx = await mountSync();
		const instance = createInstance(ctx);
		const transaction = ctx.document.apply(ctx.document.setProps('bg', { width: 33 }), USER);
		expect(childWidth(ctx, instance)).toBe(33);
		expect(transaction.changes.length).toBeGreaterThan(1);
		ctx.history.undo();
		expect(childWidth(ctx, instance)).toBe(100);
		expect(Reflect.get(ctx.document.require('bg'), 'width')).toBe(100);
		ctx.history.redo();
		expect(childWidth(ctx, instance)).toBe(33);
	});

	it('marks an instance edit as an override, and keeps it through main edits', async () => {
		const ctx = await mountSync();
		const instance = createInstance(ctx);
		const copy = ctx.document.childNodes(instance)[0];
		ctx.document.apply(ctx.document.setProps(copy.id, { width: 5 }), USER);
		expect(ctx.componentSync.overridesOf(copy.id)).toEqual(['geometry']);
		ctx.document.apply(ctx.document.setProps('bg', { width: 44 }), USER);
		expect(childWidth(ctx, instance)).toBe(5);
		ctx.history.undo();
		ctx.history.undo();
		expect(ctx.componentSync.overridesOf(copy.id)).toEqual([]);
	});

	it('detaches as one undo step', async () => {
		const ctx = await mountSync();
		const instance = createInstance(ctx);
		const plan = planDetach(ctx.document.reader, [instance]);
		ctx.document.apply(plan.changes, USER);
		expect(ctx.document.has(instance)).toBe(false);
		ctx.history.undo();
		expect(ctx.document.has(instance)).toBe(true);
		expect(ctx.componentSync.mainOf(instance)?.id).toBe('M');
	});
});
