import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { GradientPaint } from '../../lib/document';
import { defaultGradientTransform, handlePoints } from '../../lib/editing/gradient';
import { panelProviders } from '../../lib/editing/fixtures/panelHarness';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import colorPicker from '../color-picker';
import coreTools from '../core-tools';
import overlay from '../overlay';
import gradientEditor from './index';

const providers = [...panelProviders(), colorPicker, coreTools, overlay];

describePlugin('gradient-editor', gradientEditor, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.gradientEditor).toBeDefined();
		expect(ctx.tools.get('gradient-edit')).toBeDefined();
		expect(ctx.overlay.registry.listAll().map((entry) => entry.id)).toContain(
			'gradient-editor/handles'
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

function startPaint(): GradientPaint {
	return {
		type: 'GRADIENT_LINEAR',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		gradientTransform: defaultGradientTransform(),
		gradientStops: [
			{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
			{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
		]
	};
}

async function open(): Promise<{ current: () => GradientPaint; ctx: MountedPlugin['ctx'] }> {
	mounted = await mountPlugin(gradientEditor, { providers });
	target = document.createElement('div');
	document.body.append(target);
	host = mount(HostRoot, { target, props: { ctx: mounted.ctx, region: 'overlay' } });
	let paint = startPaint();
	mounted.ctx.gradientEditor.open({
		anchor,
		nodeId: 'a',
		label: 'Fill gradient',
		paint: () => paint,
		onchange: (next) => {
			paint = next;
		}
	});
	flushSync();
	return { current: () => paint, ctx: mounted.ctx };
}

function click(selector: string): void {
	const element = document.querySelector<HTMLElement>(selector);
	if (!element) throw new Error(`nothing matches ${selector}`);
	element.click();
	flushSync();
}

describe('gradient editor', () => {
	it('activates its tool while open and reverts to the default on close', async () => {
		const { ctx } = await open();
		expect(ctx.tools.activeId()).toBe('gradient-edit');
		ctx.gradientEditor.close();
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('Escape through the tools service closes the editor', async () => {
		const { ctx } = await open();
		expect(ctx.tools.cancel()).toBe(true);
		expect(ctx.gradientEditor.isOpen).toBe(false);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('switches the gradient type', async () => {
		const { current } = await open();
		click('button[aria-label="Radial"]');
		expect(current().type).toBe('GRADIENT_RADIAL');
	});

	it('reverses the stops', async () => {
		const { current } = await open();
		click('button[aria-label="Reverse stops"]');
		expect(current().gradientStops[0].color).toMatchObject({ b: 1 });
	});

	it('rotates the handles a quarter turn about the box centre', async () => {
		const { current } = await open();
		click('button[aria-label="Rotate 90 degrees"]');
		const points = handlePoints(current());
		expect(points.origin.x).toBeCloseTo(0.5, 1);
	});

	it('moves the end handle through the tool and reports a scrub', async () => {
		const { ctx, current } = await open();
		const frameNode = ctx.document.require('a');
		if (!('width' in frameNode)) throw new Error('fixture node has no size');
		const world = ctx.document.absoluteBounds('a');
		const grab = { x: world.x + world.width, y: world.y + world.height / 2 };
		ctx.tools.pointerDown({
			screen: grab,
			world: grab,
			button: 0,
			detail: 1,
			pointerId: 1,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false
		});
		const moved = { x: world.x + world.width / 2, y: world.y + world.height };
		ctx.tools.pointerMove({
			screen: moved,
			world: moved,
			button: 0,
			detail: 1,
			pointerId: 1,
			shiftKey: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false
		});
		const points = handlePoints(current());
		expect(points.end.x).toBeCloseTo(0.5, 5);
		expect(points.end.y).toBeCloseTo(1, 5);
	});
});
