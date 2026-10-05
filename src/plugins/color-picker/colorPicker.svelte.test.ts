import type { Context } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { RGBA, Variable } from '../../lib/document';
import { panelProviders } from '../../lib/editing/fixtures/panelHarness';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { variablesForScope } from '../../lib/services/colorPicker';
import colorPicker from './index';

describePlugin('color-picker', colorPicker, {
	providers: panelProviders(),
	contributes: ({ ctx }) => {
		expect(ctx.colorPicker).toBeDefined();
		expect(ctx.regions.registry.listAll().map((entry) => entry.id)).toContain(
			'color-picker/popover'
		);
	}
});

const anchor = { x: 600, y: 100, width: 24, height: 24 };

let mounted: MountedPlugin | undefined;
let host: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	target?.remove();
	await mounted?.cleanup();
	mounted = undefined;
	host = undefined;
});

async function open(
	color: RGBA,
	onchange: (color: RGBA, gesture: string) => void
): Promise<Context> {
	mounted = await mountPlugin(colorPicker, { providers: panelProviders() });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'overlay' } });
	mounted.ctx.colorPicker.open({ anchor, label: 'Fill colour', color: () => color, onchange });
	flushSync();
	return mounted.ctx;
}

function hexInput(): HTMLInputElement {
	const input = document.querySelector<HTMLInputElement>('input[aria-label="Hex"]');
	if (!input) throw new Error('no hex input');
	return input;
}

describe('colour picker popover', () => {
	it('shows the colour as hex, previews a typed hex live and commits it exactly', async () => {
		const edits: Array<[RGBA, string]> = [];
		await open({ r: 1, g: 0, b: 0, a: 0.5 }, (color, gesture) => edits.push([color, gesture]));
		expect(hexInput().value).toBe('FF0000');
		hexInput().value = '00ff80';
		hexInput().dispatchEvent(new Event('input', { bubbles: true }));
		hexInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(edits.map((edit) => edit[1])).toEqual(['scrub', 'commit']);
		expect(edits[0][0]).toMatchObject({ r: 0, g: 1, a: 0.5 });
		expect(edits[1][0]).toMatchObject({ r: 0, g: 1, a: 0.5 });
	});

	it('lightens with ArrowUp in the hex field', async () => {
		const edits: RGBA[] = [];
		await open({ r: 0.5, g: 0.5, b: 0.5, a: 1 }, (color) => edits.push(color));
		hexInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(edits[0].r).toBeCloseTo(0.51);
	});

	it('closes on Escape and reports it through onclose', async () => {
		const ctx = await open({ r: 0, g: 0, b: 0, a: 1 }, () => {});
		expect(ctx.colorPicker.isOpen).toBe(true);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(ctx.colorPicker.isOpen).toBe(false);
		expect(document.querySelector('[data-color-picker]')).toBeNull();
		expect(ctx.colorPicker.state.recent).toHaveLength(1);
	});

	it('disposes by identity: an old disposer does not close a newer picker', async () => {
		const ctx = await open({ r: 0, g: 0, b: 0, a: 1 }, () => {});
		const second = ctx.colorPicker.open({
			anchor,
			label: 'Other',
			color: () => ({ r: 1, g: 1, b: 1, a: 1 }),
			onchange: () => {}
		});
		expect(ctx.colorPicker.isOpen).toBe(true);
		second();
		expect(ctx.colorPicker.isOpen).toBe(false);
	});
});

describe('variablesForScope', () => {
	function variable(
		id: string,
		resolvedType: Variable['resolvedType'],
		scopes: string[]
	): Variable {
		return {
			id,
			name: id,
			collectionId: 'c',
			resolvedType,
			valuesByMode: {},
			scopes,
			codeSyntax: {},
			description: ''
		};
	}

	it('keeps colour variables whose scopes allow the target', () => {
		const all = [
			variable('open', 'COLOR', []),
			variable('fills', 'COLOR', ['ALL_FILLS']),
			variable('strokes', 'COLOR', ['STROKE_COLOR']),
			variable('number', 'FLOAT', [])
		];
		expect(variablesForScope(all, 'FILL').map((entry) => entry.id)).toEqual(['open', 'fills']);
		expect(variablesForScope(all, 'STROKE').map((entry) => entry.id)).toEqual(['open', 'strokes']);
		expect(variablesForScope(all, undefined)).toHaveLength(3);
	});
});
