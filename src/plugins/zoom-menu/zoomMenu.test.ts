import type { Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import zoomMenu from './index';
import { parseZoomPercent, ZOOM_MENU } from './zoomValue';

// A stand-in for the viewport service: the plugin only needs `zoom` and `zoomTo`.
const fakeViewport: Plugin = {
	name: 'fake-viewport',
	inject: [],
	apply(ctx) {
		const state = { zoom: 0.4 };
		ctx.provide('viewport', {
			get zoom() {
				return state.zoom;
			},
			zoomTo(scale: number) {
				state.zoom = scale;
			}
		});
	}
};

const providers = [coreRegions, coreContextKeys, coreCommands, coreKeymap, coreMenus, fakeViewport];

describePlugin('zoom-menu', zoomMenu, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.regions.contributions('top-bar').map((entry) => entry.id)).toEqual([
			'zoom-menu/control'
		]);
		expect(ctx.menus.has(ZOOM_MENU)).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;
let target: HTMLElement | undefined;
let host: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	host = undefined;
	target = undefined;
	await mounted?.cleanup();
	mounted = undefined;
});

async function render(): Promise<{ ctx: MountedPlugin['ctx']; element: HTMLElement }> {
	mounted = await mountPlugin(zoomMenu, { providers });
	const { ctx } = mounted;
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx, region: 'top-bar' } });
	flushSync();
	return { ctx, element: target };
}

describe('zoom menu control', () => {
	it('shows the zoom as a percentage', async () => {
		const { element } = await render();
		expect(element.querySelector<HTMLInputElement>('input')?.value).toBe('40%');
	});

	it('typing a value and pressing Enter sets the zoom', async () => {
		const { ctx, element } = await render();
		const input = element.querySelector<HTMLInputElement>('input');
		if (!input) throw new Error('no input');
		input.value = '150';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(ctx.viewport.zoom).toBe(1.5);
	});

	it('the caret opens the zoom menu', async () => {
		const { ctx, element } = await render();
		element.querySelector<HTMLButtonElement>('[aria-label="Zoom options"]')?.click();
		expect(ctx.menus.popup?.menu).toBe(ZOOM_MENU);
	});
});

describe('parseZoomPercent', () => {
	it('accepts plain numbers, percent signs and decimal commas', () => {
		expect(parseZoomPercent('150')).toBe(150);
		expect(parseZoomPercent(' 150 % ')).toBe(150);
		expect(parseZoomPercent('12,5')).toBe(12.5);
	});

	it('rejects non-numbers and clamps the range', () => {
		expect(parseZoomPercent('abc')).toBeUndefined();
		expect(parseZoomPercent('')).toBeUndefined();
		expect(parseZoomPercent('-5')).toBeUndefined();
		expect(parseZoomPercent('999999')).toBe(25600);
		expect(parseZoomPercent('0.1')).toBe(2);
	});
});
