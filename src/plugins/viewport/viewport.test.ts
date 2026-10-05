import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { FrameDriver } from '../../lib/renderer/frameScheduler';
import type { SceneSource } from '../../lib/renderer/sceneSource';
import type { FrameRequest, FrameResult, RenderBackend } from '../../lib/renderer/types';
import { absoluteBoundsOf } from '../../lib/renderer/bounds';
import type { CanvasWheelEvent } from '../../lib/viewport/wheel';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreMenus from '../core-menus';
import coreRegions from '../core-regions';
import documentPlugin from '../document';
import documentScene from '../document-scene';
import selection from '../selection';
import variablesCore from '../variables-core';
import debug from '../debug';
import renderer from '../renderer';
import sceneFixture from '../scene-fixture';
import { FIRST_PAGE_ID, SECOND_PAGE_ID } from '../scene-fixture/fixture';
import viewport from './index';

class ManualDriver implements FrameDriver {
	callbacks: (() => void)[] = [];

	request(callback: () => void): number {
		this.callbacks.push(callback);
		return this.callbacks.length;
	}

	cancel(): void {
		this.callbacks = [];
	}

	tick(): void {
		const pending = this.callbacks;
		this.callbacks = [];
		for (const callback of pending) callback();
	}
}

class RecordingBackend implements RenderBackend {
	readonly requests: FrameRequest[] = [];

	resize(): void {}

	render(request: FrameRequest): FrameResult {
		this.requests.push(request);
		return { drawn: true, drawnNodes: 0, layers: 0 };
	}

	dispose(): void {}
}

const fakeCanvasKit = {
	name: 'fake-canvaskit',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('canvaskit', {})
} as Plugin;

const CANVAS = { width: 1000, height: 800 };

let driver: ManualDriver;
let backend: RecordingBackend;

function providers(): Plugin[] {
	driver = new ManualDriver();
	backend = new RecordingBackend();
	const configuredRenderer = {
		...renderer,
		apply: (ctx: Context) =>
			renderer.apply(ctx, { frameDriver: driver, createBackend: () => backend })
	} as Plugin;
	return [
		coreRegions,
		coreContextKeys,
		coreCommands,
		coreKeymap,
		coreMenus,
		fakeCanvasKit,
		documentPlugin,
		variablesCore,
		selection,
		configuredRenderer,
		documentScene,
		{
			...sceneFixture,
			apply: (ctx: Context) => sceneFixture.apply(ctx, { enabled: true, startPage: FIRST_PAGE_ID })
		} as Plugin
	];
}

let mounted: MountedPlugin | undefined;

function sceneSourceOf(ctx: Context): SceneSource {
	const source = ctx.renderer.sceneSource;
	if (!source) throw new Error('no scene source');
	return source;
}

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

// A mounted viewport on a 1000 x 800 canvas showing the fixture's first page.
async function mountViewport(): Promise<MountedPlugin> {
	mounted = await mountPlugin(viewport, { providers: providers() });
	const { ctx } = mounted;
	// The renderer plugin is configured with the recording backend; give it a canvas box.
	const owner = {
		name: 'canvas-owner',
		inject: ['renderer'],
		apply(ownerContext: Context): void {
			ownerContext.renderer.attachCanvas(document.createElement('canvas'));
			ownerContext.renderer.resize(CANVAS.width, CANVAS.height, 1);
		}
	} as Plugin;
	await ctx.plugin(owner);
	await new Promise((resolve) => setTimeout(resolve, 0));
	return mounted;
}

function wheel(overrides: Partial<CanvasWheelEvent>): CanvasWheelEvent {
	return {
		deltaX: 0,
		deltaY: 0,
		deltaMode: 0,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		screen: { x: 0, y: 0 },
		preventDefault: () => {},
		...overrides
	};
}

describe('viewport service', () => {
	it('fits the first page on its first visit, framing all content with padding', async () => {
		const { ctx } = await mountViewport();
		expect(ctx.viewport.pageId).toBe(FIRST_PAGE_ID);
		// content spans x 0..900 and y 0..750 on the first page
		const visible = ctx.viewport.visibleRect();
		expect(visible.x).toBeLessThan(0);
		expect(visible.x + visible.width).toBeGreaterThan(900);
		expect(visible.y).toBeLessThan(0);
		expect(visible.y + visible.height).toBeGreaterThan(750);
		const topLeft = ctx.viewport.worldToScreen({ x: 0, y: 0 });
		expect(topLeft.x).toBeGreaterThanOrEqual(64 - 1e-6);
		expect(topLeft.y).toBeGreaterThanOrEqual(64 - 1e-6);
	});

	it('the renderer draws through the viewport camera and redraws on every camera change', async () => {
		const { ctx } = await mountViewport();
		driver.tick();
		const camera = ctx.viewport.camera;
		expect(backend.requests[backend.requests.length - 1].view).toEqual(camera);
		const before = backend.requests.length;
		ctx.viewport.panBy(30, 40);
		driver.tick();
		expect(backend.requests.length).toBe(before + 1);
		expect(backend.requests[before].view).toEqual({
			x: camera.x + 30,
			y: camera.y + 40,
			scale: camera.scale
		});
	});

	it('wheel pans, and ctrl-wheel zooms keeping the world point under the cursor fixed', async () => {
		const { ctx } = await mountViewport();
		const before = ctx.viewport.camera;
		let prevented = 0;
		ctx.emit('canvas/wheel', wheel({ deltaY: 20, preventDefault: () => (prevented += 1) }));
		expect(ctx.viewport.camera).toEqual({ x: before.x, y: before.y - 20, scale: before.scale });
		expect(prevented).toBe(1);

		const cursor = { x: 420, y: 310 };
		const worldBefore = ctx.viewport.screenToWorld(cursor);
		ctx.emit('canvas/wheel', wheel({ deltaY: -100, ctrlKey: true, screen: cursor }));
		expect(ctx.viewport.zoom).toBeGreaterThan(before.scale);
		const worldAfter = ctx.viewport.screenToWorld(cursor);
		expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
		expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
	});

	it('zoom 100 percent, zoom in and out step along the ladder around the canvas centre', async () => {
		const { ctx } = await mountViewport();
		await ctx.commands.run('viewport.zoom-100');
		expect(ctx.viewport.zoom).toBe(1);
		const centre = { x: CANVAS.width / 2, y: CANVAS.height / 2 };
		const worldAtCentre = ctx.viewport.screenToWorld(centre);
		await ctx.commands.run('viewport.zoom-in');
		expect(ctx.viewport.zoom).toBe(1.5);
		await ctx.commands.run('viewport.zoom-in');
		expect(ctx.viewport.zoom).toBe(2);
		await ctx.commands.run('viewport.zoom-out');
		await ctx.commands.run('viewport.zoom-out');
		await ctx.commands.run('viewport.zoom-out');
		expect(ctx.viewport.zoom).toBe(0.66);
		const worldAfter = ctx.viewport.screenToWorld(centre);
		expect(worldAfter.x).toBeCloseTo(worldAtCentre.x, 6);
		expect(worldAfter.y).toBeCloseTo(worldAtCentre.y, 6);
	});

	it('zoom to fit frames everything; zoom to selection frames just the selected nodes', async () => {
		const { ctx } = await mountViewport();
		await ctx.commands.run('viewport.zoom-100');
		await ctx.commands.run('viewport.zoom-to-fit');
		const fitScale = ctx.viewport.zoom;
		expect(fitScale).toBeLessThan(1);

		ctx.selection.select(['frame-b']);
		await ctx.commands.run('viewport.zoom-to-selection');
		const frameB = absoluteBoundsOf(sceneSourceOf(ctx), 'frame-b');
		expect(frameB).toEqual({ x: 600, y: 100, width: 300, height: 300 });
		const topLeft = ctx.viewport.worldToScreen({ x: 600, y: 100 });
		const bottomRight = ctx.viewport.worldToScreen({ x: 900, y: 400 });
		expect(ctx.viewport.zoom).toBeGreaterThan(fitScale);
		expect(topLeft.x).toBeGreaterThanOrEqual(64 - 1e-6);
		expect(topLeft.y).toBeGreaterThanOrEqual(64 - 1e-6);
		expect(CANVAS.width - bottomRight.x).toBeGreaterThanOrEqual(64 - 1e-6);
		expect(CANVAS.height - bottomRight.y).toBeGreaterThanOrEqual(64 - 1e-6);
	});

	it('zoom to selection does nothing without a selection', async () => {
		const { ctx } = await mountViewport();
		const before = ctx.viewport.camera;
		await ctx.commands.run('viewport.zoom-to-selection');
		expect(ctx.viewport.camera).toEqual(before);
	});

	it('next and previous frame walk the top-level frames and wrap around', async () => {
		const { ctx } = await mountViewport();
		const centreOf = (id: string): { x: number; y: number } => {
			const bounds = absoluteBoundsOf(sceneSourceOf(ctx), id);
			if (!bounds) throw new Error(`no bounds for ${id}`);
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		};
		const viewCentre = (): { x: number; y: number } =>
			ctx.viewport.screenToWorld({ x: CANVAS.width / 2, y: CANVAS.height / 2 });
		await ctx.commands.run('viewport.next-frame');
		const first = viewCentre();
		await ctx.commands.run('viewport.next-frame');
		const second = viewCentre();
		expect(first).not.toEqual(second);
		await ctx.commands.run('viewport.previous-frame');
		expect(viewCentre().x).toBeCloseTo(first.x, 6);
		for (let step = 0; step < 2; step += 1) await ctx.commands.run('viewport.next-frame');
		await ctx.commands.run('viewport.next-frame');
		const wrapped = viewCentre();
		const centres = ['frame-a', 'frame-b', 'frame-c'].map(centreOf);
		expect(
			centres.some((centre) => Math.hypot(centre.x - wrapped.x, centre.y - wrapped.y) < 1e-6)
		).toBe(true);
	});

	it('next frame after a manual camera move continues from the frame nearest the middle', async () => {
		const { ctx } = await mountViewport();
		const viewCentre = (): { x: number; y: number } =>
			ctx.viewport.screenToWorld({ x: CANVAS.width / 2, y: CANVAS.height / 2 });
		await ctx.commands.run('viewport.next-frame');
		await ctx.commands.run('viewport.next-frame');
		// fit-all is a camera move: the walk starts over from the frame nearest the middle, which is
		// frame C (centre 450, 625), so the next frame is A (centre 200, 150)
		await ctx.commands.run('viewport.zoom-to-fit');
		await ctx.commands.run('viewport.next-frame');
		expect(viewCentre().x).toBeCloseTo(200, 6);
		expect(viewCentre().y).toBeCloseTo(150, 6);
	});

	it('arrow keys pan while nothing is selected and leave the camera alone with a selection', async () => {
		const { ctx } = await mountViewport();
		const press = async (init: KeyboardEventInit): Promise<void> => {
			window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
			await new Promise((resolve) => setTimeout(resolve, 0));
		};
		const before = ctx.viewport.camera;
		await press({ key: 'ArrowLeft', code: 'ArrowLeft' });
		expect(ctx.viewport.camera.x).toBe(before.x + 60);
		await press({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: true });
		expect(ctx.viewport.camera.y).toBe(before.y - 240);

		const dispose = ctx.contextKeys.set('hasSelection', true);
		const withSelection = ctx.viewport.camera;
		await press({ key: 'ArrowLeft', code: 'ArrowLeft' });
		expect(ctx.viewport.camera).toEqual(withSelection);
		dispose();
	});

	it('binds the documented shortcuts', async () => {
		const { ctx } = await mountViewport();
		const bound = (command: string): string | undefined => ctx.keymap.lookup(command);
		expect(bound('viewport.zoom-to-fit')).toMatch(/Shift\+1/);
		expect(bound('viewport.zoom-to-selection')).toMatch(/Shift\+2/);
		expect(bound('viewport.next-frame')).toMatch(/N$/);
		expect(bound('viewport.zoom-out')).toMatch(/\+-$/);
	});

	it('restores the camera of a page when it is shown again, and fits a page seen first', async () => {
		const { ctx } = await mountViewport();
		await ctx.commands.run('viewport.zoom-100');
		ctx.viewport.panBy(-123, 45);
		const firstPageCamera = ctx.viewport.camera;

		ctx.document.setCurrentPage(SECOND_PAGE_ID);
		expect(ctx.viewport.pageId).toBe(SECOND_PAGE_ID);
		const secondPageCamera = ctx.viewport.camera;
		expect(secondPageCamera).not.toEqual(firstPageCamera);
		expect(secondPageCamera.scale).toBeLessThanOrEqual(256);
		ctx.viewport.zoomAt({ x: 10, y: 10 }, 3);

		ctx.document.setCurrentPage(FIRST_PAGE_ID);
		expect(ctx.viewport.camera).toEqual(firstPageCamera);
		ctx.document.setCurrentPage(SECOND_PAGE_ID);
		expect(ctx.viewport.camera.scale).toBe(3);
	});

	it('exposes zoom through the debug surface summary', async () => {
		const enabledDebug = {
			...debug,
			apply: (debugContext: Context) => debug.apply(debugContext, { enabled: true })
		} as Plugin;
		mounted = await mountPlugin(viewport, { providers: [...providers(), enabledDebug] });
		const { ctx } = mounted;
		await new Promise((resolve) => setTimeout(resolve, 0));
		const summaryZoom = (): unknown => {
			const surface: unknown = Reflect.get(window, '__design_debug');
			if (typeof surface !== 'object' || surface === null) throw new Error('no debug surface');
			const summary: unknown = Reflect.apply(Reflect.get(surface, 'summary'), surface, []);
			if (typeof summary !== 'object' || summary === null) throw new Error('no summary');
			return Reflect.get(summary, 'zoom');
		};
		expect(summaryZoom()).toBe(ctx.viewport.zoom);
		ctx.viewport.zoomTo(2);
		expect(summaryZoom()).toBe(2);
	});
});

describePlugin('viewport', viewport, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.viewport).toBeDefined();
		expect(ctx.commands.registry.get('viewport.zoom-to-fit')).toBeDefined();
	}
});
