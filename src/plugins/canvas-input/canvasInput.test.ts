import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { FrameDriver } from '../../lib/renderer/frameScheduler';
import type { FrameResult, RenderBackend } from '../../lib/renderer/types';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import coreTools from '../core-tools';
import renderer from '../renderer';
import sceneFixture from '../scene-fixture';
import viewTools from '../view-tools';
import viewport from '../viewport';
import canvasInput from './index';

class IdleDriver implements FrameDriver {
	request(): number {
		return 0;
	}
	cancel(): void {}
}

class NullBackend implements RenderBackend {
	resize(): void {}
	render(): FrameResult {
		return { drawn: true, drawnNodes: 0, layers: 0 };
	}
	dispose(): void {}
}

const fakeCanvasKit = {
	name: 'fake-canvaskit',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('canvaskit', {})
} as Plugin;

function providers(): Plugin[] {
	const configuredRenderer = {
		...renderer,
		apply: (ctx: Context) =>
			renderer.apply(ctx, {
				frameDriver: new IdleDriver(),
				createBackend: () => new NullBackend()
			})
	} as Plugin;
	return [
		coreRegions,
		coreContextKeys,
		coreCommands,
		coreKeymap,
		coreMenus,
		coreTools,
		fakeCanvasKit,
		configuredRenderer,
		{
			...sceneFixture,
			apply: (ctx: Context) => sceneFixture.apply(ctx, { enabled: true })
		} as Plugin,
		viewport
	];
}

function makeCanvas(): HTMLCanvasElement {
	const element = document.createElement('canvas');
	const captured = new Set<number>();
	element.setPointerCapture = (id: number): void => void captured.add(id);
	element.releasePointerCapture = (id: number): void => void captured.delete(id);
	element.hasPointerCapture = (id: number): boolean => captured.has(id);
	element.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 1000, 800);
	document.body.append(element);
	return element;
}

interface PointerInit {
	x: number;
	y: number;
	button?: number;
	altKey?: boolean;
}

function pointer(type: string, init: PointerInit): MouseEvent {
	let button = 0;
	if (init.button !== undefined) button = init.button;
	const event = new MouseEvent(type, {
		clientX: init.x,
		clientY: init.y,
		button,
		altKey: init.altKey === true,
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(event, 'pointerId', { value: 1 });
	return event;
}

let mounted: MountedPlugin | undefined;
let canvas: HTMLCanvasElement | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	canvas?.remove();
	mounted = undefined;
	canvas = undefined;
});

async function mountRouter(withViewTools: boolean): Promise<MountedPlugin> {
	const extra: Plugin[] = [];
	if (withViewTools) extra.push(viewTools);
	mounted = await mountPlugin(canvasInput, { providers: [...providers(), ...extra] });
	const element = makeCanvas();
	canvas = element;
	const owner = {
		name: 'canvas-owner',
		inject: ['renderer'],
		apply(ownerContext: Context): void {
			ownerContext.renderer.attachCanvas(element);
			ownerContext.renderer.resize(1000, 800, 1);
		}
	} as Plugin;
	await mounted.ctx.plugin(owner);
	await new Promise((resolve) => setTimeout(resolve, 0));
	return mounted;
}

describePlugin('canvas-input', canvasInput, {
	providers: providers(),
	contributes: ({ ctx }) => expect(ctx.canvasInput).toBeDefined()
});

describe('canvas input router', () => {
	it('hands pointer events to the active tool with screen and world coordinates', async () => {
		const { ctx } = await mountRouter(false);
		const received: ToolPointerEvent[] = [];
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'move',
					title: 'Move',
					onPointerDown: (event) => received.push(event)
				}),
			'test tool'
		);
		canvas?.dispatchEvent(pointer('pointerdown', { x: 100, y: 50 }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 100, y: 50 }));
		expect(received).toHaveLength(1);
		expect(received[0].screen).toEqual({ x: 100, y: 50 });
		expect(received[0].world).toEqual(ctx.viewport.screenToWorld({ x: 100, y: 50 }));
	});

	it('counts presses close in time and place, because pointer events carry no click count', async () => {
		const { ctx } = await mountRouter(false);
		const details: number[] = [];
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'move',
					title: 'Move',
					onPointerDown: (event) => details.push(event.detail)
				}),
			'test tool'
		);
		const press = (x: number): void => {
			canvas?.dispatchEvent(pointer('pointerdown', { x, y: 50 }));
			canvas?.dispatchEvent(pointer('pointerup', { x, y: 50 }));
		};
		press(100);
		press(102);
		press(300);
		expect(details).toEqual([1, 2, 1]);
	});

	it('passes the coalesced samples of a move as world points', async () => {
		const { ctx } = await mountRouter(false);
		const received: ToolPointerEvent[] = [];
		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'move',
					title: 'Move',
					onPointerMove: (event) => received.push(event)
				}),
			'test tool'
		);
		const move = pointer('pointermove', { x: 30, y: 30 });
		const samples = [
			{ clientX: 10, clientY: 10 },
			{ clientX: 20, clientY: 25 },
			{ clientX: 30, clientY: 30 }
		];
		Object.defineProperty(move, 'getCoalescedEvents', { value: () => samples });
		canvas?.dispatchEvent(move);
		expect(received[0].coalesced).toEqual(
			samples.map((sample) => ctx.viewport.screenToWorld({ x: sample.clientX, y: sample.clientY }))
		);
	});

	it('pushes the canvas keymap scope while the canvas has focus', async () => {
		const { ctx } = await mountRouter(false);
		expect(ctx.keymap.scopes.list()).toHaveLength(0);
		canvas?.dispatchEvent(new FocusEvent('focus'));
		expect(ctx.keymap.scopes.list().map((scope) => scope.name)).toEqual(['canvas']);
		canvas?.dispatchEvent(new FocusEvent('blur'));
		expect(ctx.keymap.scopes.list()).toHaveLength(0);
	});

	it('keeps canvas/wheel and canvas/contextmenu events flowing', async () => {
		const { ctx } = await mountRouter(false);
		let menus = 0;
		ctx.on('canvas/contextmenu', () => (menus += 1));
		const before = ctx.viewport.camera;
		canvas?.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, cancelable: true }));
		expect(ctx.viewport.camera.y).toBe(before.y - 20);
		canvas?.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
		expect(menus).toBe(1);
	});

	it('tracks modifier state', async () => {
		const { ctx } = await mountRouter(false);
		expect(ctx.canvasInput.modifiers.altKey).toBe(false);
		canvas?.dispatchEvent(pointer('pointermove', { x: 1, y: 1, altKey: true }));
		expect(ctx.canvasInput.modifiers.altKey).toBe(true);
	});

	it('the hand tool pans on primary drag and on middle drag, then restores the tool', async () => {
		const { ctx } = await mountRouter(true);
		const start = ctx.viewport.camera;
		ctx.tools.activate('hand');
		canvas?.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
		canvas?.dispatchEvent(pointer('pointermove', { x: 130, y: 90 }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 130, y: 90 }));
		expect(ctx.viewport.camera).toEqual({ x: start.x + 30, y: start.y - 10, scale: start.scale });

		ctx.tools.revertToDefault();
		canvas?.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, button: 1 }));
		expect(ctx.tools.activeId()).toBe('hand');
		canvas?.dispatchEvent(pointer('pointermove', { x: 20, y: 10 }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 20, y: 10, button: 1 }));
		expect(ctx.viewport.camera.x).toBe(start.x + 40);
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('the zoom tool zooms in on click, out on alt-click, and to the dragged rectangle', async () => {
		const { ctx } = await mountRouter(true);
		await ctx.commands.run('viewport.zoom-100');
		ctx.tools.activate('zoom');
		canvas?.dispatchEvent(pointer('pointerdown', { x: 300, y: 300 }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 300, y: 300 }));
		expect(ctx.viewport.zoom).toBe(1.5);
		canvas?.dispatchEvent(pointer('pointerdown', { x: 300, y: 300, altKey: true }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 300, y: 300, altKey: true }));
		expect(ctx.viewport.zoom).toBe(1);

		canvas?.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
		canvas?.dispatchEvent(pointer('pointermove', { x: 300, y: 200 }));
		canvas?.dispatchEvent(pointer('pointerup', { x: 300, y: 200 }));
		expect(ctx.viewport.zoom).toBeCloseTo(5, 6);
	});
});
