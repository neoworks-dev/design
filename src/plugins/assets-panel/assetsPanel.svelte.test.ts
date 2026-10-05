import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { NodeId } from '../../lib/document';
import { solidPaint } from '../../lib/editing/paints';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import assetsPanel from './index';
import { assetsProviders, hit } from './fixtures/assetsFixture';
import TabHost from './fixtures/TabHost.svelte';

describePlugin('assets-panel', assetsPanel, {
	providers: assetsProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.assetsPanel).toBeDefined();
		expect(ctx.commands.has('panels.show.assets')).toBe(true);
		expect(ctx.commands.has('assets.component.go-to-main')).toBe(true);
		const menuItems = ctx.menus.registry.listAll().map((entry) => entry.id);
		expect(menuItems).toContain('context/asset-component|assets.component.delete');
		expect(menuItems).toContain('context/asset-paint-style|assets.style.apply-stroke');
	}
});

let mounted: MountedPlugin | undefined;
let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (host !== undefined) await unmount(host);
	target?.remove();
	await mounted?.cleanup();
	host = undefined;
	target = undefined;
	mounted = undefined;
	hit.id = undefined;
	document.body.querySelector('[data-canvas-host]')?.remove();
	Reflect.deleteProperty(document, 'elementFromPoint');
});

async function open(): Promise<Context> {
	mounted = await mountPlugin(assetsPanel, { providers: assetsProviders() });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(TabHost, { target, props: { ctx: mounted.ctx } });
	flushSync();
	return mounted.ctx;
}

function rows(): string[] {
	return [...document.body.querySelectorAll('[data-asset-component]')].map(
		(element) => element.getAttribute('data-asset-component') ?? ''
	);
}

function worldBounds(ctx: Context, id: NodeId): number[] {
	const bounds = ctx.document.reader.cache.absoluteBounds(id);
	return [bounds.x, bounds.y, bounds.width, bounds.height];
}

describe('the list', () => {
	it('lists the components grouped by slash path and filters by the search', async () => {
		const ctx = await open();
		expect(rows()).toEqual(['m-icon', 'm-host', 'm-primary']);
		expect(document.body.querySelector('[data-asset-group="Button"]')).not.toBeNull();
		ctx.assetsPanel.setQuery('icon');
		flushSync();
		expect(rows()).toEqual(['m-icon']);
		ctx.assetsPanel.setQuery('nothing like it');
		flushSync();
		expect(rows()).toEqual([]);
	});

	it('lists styles and applies one to the selection with a click', async () => {
		const ctx = await open();
		ctx.document.apply(ctx.document.setProps('a', { fills: [solidPaint({ r: 1, g: 0, b: 0 })] }), {
			origin: 'user',
			label: 'Setup'
		});
		const styleId = ctx.styles.create('fill', ['a'], 'Brand/Red');
		ctx.selection.select(['b']);
		flushSync();
		const row = document.body.querySelector(`[data-asset-style="${styleId}"] button`);
		if (!(row instanceof HTMLElement)) throw new Error('no style row');
		row.click();
		flushSync();
		expect(ctx.document.require('b')).toMatchObject({ fillStyleId: styleId });
	});
});

describe('inserting instances', () => {
	it('inserts at the middle of the selected frame in one undo step and selects it', async () => {
		const ctx = await open();
		ctx.selection.select(['f']);
		const steps = ctx.history.entries.length;
		const id = ctx.assetsPanel.insertAtDefault('m-primary');
		if (id === undefined) throw new Error('nothing inserted');
		expect(ctx.document.require(id)).toMatchObject({
			type: 'INSTANCE',
			mainComponentId: 'm-primary',
			parentId: 'f'
		});
		expect(worldBounds(ctx, id)).toEqual([150, 180, 100, 40]);
		expect(ctx.selection.ids).toEqual([id]);
		expect(ctx.history.entries).toHaveLength(steps + 1);
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
	});

	it('inserts at the centre of the viewport when nothing is selected', async () => {
		const ctx = await open();
		const id = ctx.assetsPanel.insertAtDefault('m-icon');
		if (id === undefined) throw new Error('nothing inserted');
		expect(ctx.document.require(id)).toMatchObject({ parentId: 'p' });
		expect(worldBounds(ctx, id)).toEqual([1088, 1038, 24, 24]);
	});

	it('inserts with Enter on the focused row and with a double click', async () => {
		const ctx = await open();
		const row = document.body.querySelector('[data-asset-component="m-icon"]');
		if (!(row instanceof HTMLElement)) throw new Error('no row');
		row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(1);
		row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		flushSync();
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(2);
	});

	it('drags a row onto the canvas and inserts an instance under the pointer', async () => {
		const ctx = await open();
		const canvasHost = document.createElement('div');
		canvasHost.setAttribute('data-canvas-host', '');
		const canvas = document.createElement('canvas');
		canvasHost.append(canvas);
		document.body.append(canvasHost);
		Reflect.set(document, 'elementFromPoint', () => canvas);

		const row = document.body.querySelector('[data-asset-component="m-icon"]');
		if (!(row instanceof HTMLElement)) throw new Error('no row');
		const pointer = (type: string, x: number, y: number): PointerEvent =>
			new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
		row.dispatchEvent(pointer('pointerdown', 10, 10));
		window.dispatchEvent(pointer('pointermove', 12, 12));
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(0);
		window.dispatchEvent(pointer('pointermove', 300, 700));
		flushSync();
		expect(document.body.querySelector('[data-asset-ghost]')).not.toBeNull();
		window.dispatchEvent(pointer('pointerup', 300, 700));
		flushSync();
		const [instance] = ctx.document.query((candidate) => candidate.type === 'INSTANCE');
		expect(worldBounds(ctx, instance.id)).toEqual([288, 688, 24, 24]);
		expect(document.body.querySelector('[data-asset-ghost]')).toBeNull();
	});

	it('a press that does not move is not a drag', async () => {
		const ctx = await open();
		const row = document.body.querySelector('[data-asset-component="m-icon"]');
		if (!(row instanceof HTMLElement)) throw new Error('no row');
		row.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0 }));
		window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 5 }));
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(0);
	});

	it('refuses to put a component inside itself and says why', async () => {
		const ctx = await open();
		ctx.selection.select(['m-host-inner']);
		flushSync();
		expect(ctx.assetsPanel.isBlocked('m-host')).toBe(true);
		expect(ctx.assetsPanel.insertAtDefault('m-host')).toBeUndefined();
		flushSync();
		expect(ctx.assetsPanel.notice).toContain('itself');
		expect(document.body.querySelector('[data-assets-notice]')).not.toBeNull();
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(0);
	});
});

describe('Alt+drag over an instance', () => {
	function dragOnto(ctx: Context, altKey: boolean): void {
		const canvasHost = document.createElement('div');
		canvasHost.setAttribute('data-canvas-host', '');
		const canvas = document.createElement('canvas');
		canvasHost.append(canvas);
		document.body.append(canvasHost);
		Reflect.set(document, 'elementFromPoint', () => canvas);
		const row = document.body.querySelector('[data-asset-component="m-primary"]');
		if (!(row instanceof HTMLElement)) throw new Error('no row');
		const pointer = (type: string, x: number, y: number): PointerEvent =>
			new PointerEvent(type, { clientX: x, clientY: y, button: 0, altKey, bubbles: true });
		row.dispatchEvent(pointer('pointerdown', 10, 10));
		window.dispatchEvent(pointer('pointermove', 300, 700));
		flushSync();
		expect(document.body.querySelector('[data-asset-swap-hint]') !== null).toBe(altKey);
		window.dispatchEvent(pointer('pointerup', 300, 700));
		flushSync();
		void ctx;
	}

	it('asks components.swap to swap the instance under the pointer', async () => {
		const ctx = await open();
		const instanceId = ctx.assetsPanel.insertAtDefault('m-icon');
		if (instanceId === undefined) throw new Error('no instance');
		const calls: unknown[] = [];
		ctx.commands.register({
			id: 'components.swap',
			title: 'Swap',
			run: (args) => void calls.push(args)
		});
		hit.id = instanceId;
		dragOnto(ctx, true);
		expect(calls).toEqual([{ mainId: 'm-primary', instanceId }]);
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(1);
	});

	it('inserts a new instance instead when Alt is not held', async () => {
		const ctx = await open();
		const instanceId = ctx.assetsPanel.insertAtDefault('m-icon');
		hit.id = instanceId;
		dragOnto(ctx, false);
		expect(ctx.document.query((candidate) => candidate.type === 'INSTANCE')).toHaveLength(2);
	});
});

describe('context menu commands', () => {
	it('go to main selects the component', async () => {
		const ctx = await open();
		await ctx.commands.run('assets.component.go-to-main', { id: 'm-icon' });
		expect(ctx.selection.ids).toEqual(['m-icon']);
	});

	it('delete removes the component and undo restores it', async () => {
		const ctx = await open();
		await ctx.commands.run('assets.component.delete', { id: 'm-icon' });
		expect(ctx.document.has('m-icon')).toBe(false);
		ctx.history.undo();
		expect(ctx.document.has('m-icon')).toBe(true);
	});
});
