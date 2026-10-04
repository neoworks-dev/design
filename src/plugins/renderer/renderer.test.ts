import type { Context, Plugin } from '@neoworks/extension-system';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rectangle, frame, page, buildDocument } from '../../lib/document/fixtures';
import HostRoot from '../../lib/kernel/fixtures/HostRoot.svelte';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { FrameDriver } from '../../lib/renderer/frameScheduler';
import { StoreSceneSource } from '../../lib/renderer/storeSceneSource';
import type { FrameRequest, FrameResult, RenderBackend } from '../../lib/renderer/types';
import coreRegions from '../core-regions';
import renderer, { type RendererConfig } from './index';

class FakeFrameDriver implements FrameDriver {
	private nextHandle = 1;
	readonly pending = new Map<number, () => void>();
	readonly cancelled: number[] = [];

	request(callback: () => void): number {
		const handle = this.nextHandle;
		this.nextHandle += 1;
		this.pending.set(handle, callback);
		return handle;
	}

	cancel(handle: number): void {
		this.cancelled.push(handle);
		this.pending.delete(handle);
	}

	/** Runs the animation frame callbacks that were queued before this call. */
	tick(): void {
		const callbacks = [...this.pending.values()];
		this.pending.clear();
		for (const callback of callbacks) callback();
	}
}

class FakeBackend implements RenderBackend {
	readonly renders: FrameRequest[] = [];
	readonly resizes: [number, number][] = [];
	disposed = false;
	readonly invalidations: unknown[] = [];

	resize(pixelWidth: number, pixelHeight: number): void {
		this.resizes.push([pixelWidth, pixelHeight]);
	}

	render(request: FrameRequest): FrameResult {
		this.renders.push(request);
		return { drawn: true, drawnNodes: 0, layers: 0 };
	}

	invalidate(change: unknown): void {
		this.invalidations.push(change);
	}

	dispose(): void {
		this.disposed = true;
	}
}

class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	observed: unknown[] = [];
	disconnected = false;

	constructor(readonly callback: () => void) {
		FakeResizeObserver.instances.push(this);
	}

	observe(element: unknown): void {
		this.observed.push(element);
	}

	disconnect(): void {
		this.disconnected = true;
	}

	unobserve(): void {}
}

const fakeCanvasKit = {
	name: 'fake-canvaskit',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('canvaskit', {})
} as Plugin;

function sampleSource(): StoreSceneSource {
	return new StoreSceneSource(
		buildDocument([
			page('P', [frame({ id: 'f', width: 100, height: 100 }, [rectangle({ id: 'r' })])], {
				id: 'p'
			})
		])
	);
}

let driver: FakeFrameDriver;
let backend: FakeBackend;
let mounted: MountedPlugin | undefined;
let originalResizeObserver: unknown;

function config(): RendererConfig {
	return { frameDriver: driver, createBackend: () => backend };
}

beforeEach(() => {
	driver = new FakeFrameDriver();
	backend = new FakeBackend();
	FakeResizeObserver.instances = [];
	originalResizeObserver = Reflect.get(globalThis, 'ResizeObserver');
	Reflect.set(globalThis, 'ResizeObserver', FakeResizeObserver);
});

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	Reflect.set(globalThis, 'ResizeObserver', originalResizeObserver);
});

async function mountRenderer(): Promise<MountedPlugin> {
	mounted = await mountPlugin(renderer, {
		providers: [coreRegions, fakeCanvasKit],
		config: config()
	});
	return mounted;
}

describe('renderer service', () => {
	it('draws nothing until it has both a canvas and a scene source', async () => {
		const { ctx } = await mountRenderer();
		ctx.renderer.requestFrame('manual');
		driver.tick();
		expect(backend.renders).toHaveLength(0);

		ctx.renderer.attachCanvas(document.createElement('canvas'));
		driver.tick();
		expect(backend.renders).toHaveLength(0);

		ctx.renderer.setSceneSource(sampleSource());
		driver.tick();
		expect(backend.renders).toHaveLength(1);
	});

	it('draws exactly one frame per tick however many document changes arrive in it', async () => {
		const { ctx } = await mountRenderer();
		const source = sampleSource();
		ctx.renderer.attachCanvas(document.createElement('canvas'));
		ctx.renderer.setSceneSource(source);
		driver.tick();
		expect(backend.renders).toHaveLength(1);

		for (let step = 1; step <= 5; step += 1) {
			source.apply([{ t: 'set', id: 'r', set: { width: 10 + step }, prev: { width: 9 + step } }]);
		}
		expect(driver.pending.size).toBe(1);
		driver.tick();
		expect(backend.renders).toHaveLength(2);
		expect(ctx.renderer.stats.frames).toBe(2);
		expect(ctx.renderer.stats.lastReasons).toEqual(['scene']);

		driver.tick();
		expect(backend.renders).toHaveLength(2);
	});

	it('records why each frame was requested and times it', async () => {
		const { ctx } = await mountRenderer();
		ctx.renderer.attachCanvas(document.createElement('canvas'));
		ctx.renderer.setSceneSource(sampleSource());
		ctx.renderer.requestFrame('viewport');
		ctx.renderer.requestFrame('viewport');
		driver.tick();
		const { stats } = ctx.renderer;
		expect(stats.lastReasons).toEqual(['canvas attached', 'scene-source', 'viewport']);
		expect(stats.lastResult.drawn).toBe(true);
		expect(stats.averageFrameMilliseconds).toBeGreaterThanOrEqual(0);
	});

	it('resize reconfigures the surface at css size times the device pixel ratio', async () => {
		const { ctx } = await mountRenderer();
		ctx.renderer.attachCanvas(document.createElement('canvas'));
		ctx.renderer.setSceneSource(sampleSource());
		ctx.renderer.resize(300, 200, 1);
		ctx.renderer.resize(300, 200, 2);
		ctx.renderer.resize(333, 200.4, 1.5);
		expect(backend.resizes).toEqual([
			[300, 200],
			[600, 400],
			[500, 301]
		]);
		driver.tick();
		const request = backend.renders[backend.renders.length - 1];
		expect(request.size).toEqual({ width: 333, height: 200.4 });
		expect(request.devicePixelRatio).toBe(1.5);
	});

	it('uses the view the provider returns and draws again when it is replaced', async () => {
		const { ctx } = await mountRenderer();
		ctx.renderer.attachCanvas(document.createElement('canvas'));
		ctx.renderer.setSceneSource(sampleSource());
		driver.tick();
		expect(backend.renders[0].view).toEqual({ x: 0, y: 0, scale: 1 });
		ctx.renderer.setViewProvider(() => ({ x: 5, y: 6, scale: 2 }));
		driver.tick();
		expect(backend.renders[1].view).toEqual({ x: 5, y: 6, scale: 2 });
	});

	it('hands the culling index to the backend and tells it about edits and image arrivals', async () => {
		const { ctx } = await mountRenderer();
		ctx.renderer.attachCanvas(document.createElement('canvas'));
		const source = sampleSource();
		ctx.renderer.setSceneSource(source);
		const culling = { visibleNodes: () => [] };
		const disposeCulling = ctx.renderer.setCulling(culling);
		driver.tick();
		expect(backend.renders[backend.renders.length - 1].culling).toBe(culling);
		source.notifyReset();
		expect(backend.invalidations).toEqual([{ kind: 'reset' }]);
		ctx.renderer.requestFrame('image-ready');
		expect(backend.invalidations).toHaveLength(2);
		ctx.renderer.requestFrame('viewport');
		expect(backend.invalidations).toHaveLength(2);
		disposeCulling();
		driver.tick();
		expect(backend.renders[backend.renders.length - 1].culling).toBeUndefined();
	});

	it('disposing a scene source removes only that source', async () => {
		const { ctx } = await mountRenderer();
		const first = sampleSource();
		const second = sampleSource();
		const disposeFirst = ctx.renderer.setSceneSource(first);
		ctx.renderer.setSceneSource(second);
		disposeFirst();
		expect(ctx.renderer.sceneSource).toBe(second);
		expect(first.listenerCount).toBe(0);
		expect(second.listenerCount).toBe(1);
	});

	it('cancels the pending animation frame when the renderer unloads', async () => {
		const { ctx, fiber } = await mountRenderer();
		ctx.renderer.requestFrame('pending');
		expect(driver.pending.size).toBe(1);
		await fiber.dispose();
		expect(driver.pending.size).toBe(0);
		expect(driver.cancelled).toHaveLength(1);
	});

	it('detaches the canvas and disposes the backend when the plugin that attached it unloads', async () => {
		const { ctx } = await mountRenderer();
		const owner = {
			name: 'canvas-owner',
			inject: ['renderer'],
			apply(ownerContext: Context): void {
				ownerContext.renderer.attachCanvas(document.createElement('canvas'));
			}
		} as Plugin;
		const ownerFiber = await ctx.plugin(owner);
		expect(ctx.renderer.hasCanvas).toBe(true);
		await ownerFiber.dispose();
		expect(ctx.renderer.hasCanvas).toBe(false);
		expect(backend.disposed).toBe(true);
	});
});

describe('canvas region component', () => {
	let target: HTMLElement | undefined;
	let host: ReturnType<typeof mount> | undefined;

	afterEach(async () => {
		if (host) await unmount(host);
		target?.remove();
		host = undefined;
		target = undefined;
	});

	async function renderCanvasRegion(): Promise<MountedPlugin> {
		const result = await mountRenderer();
		target = document.createElement('div');
		document.body.append(target);
		host = mount(HostRoot, { target, props: { ctx: result.ctx, region: 'canvas' } });
		flushSync();
		return result;
	}

	it('fills the canvas region with a canvas that the renderer draws on', async () => {
		const { ctx } = await renderCanvasRegion();
		expect(target?.querySelector('canvas[data-renderer-canvas]')).not.toBeNull();
		expect(ctx.renderer.hasCanvas).toBe(true);
	});

	it('observes its box and disconnects when the plugin unloads, removing the canvas', async () => {
		const { fiber } = await renderCanvasRegion();
		expect(FakeResizeObserver.instances).toHaveLength(1);
		expect(FakeResizeObserver.instances[0].observed).toHaveLength(1);
		await fiber.dispose();
		flushSync();
		expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
		expect(target?.querySelector('canvas')).toBeNull();
	});

	it('a resize observation reconfigures the surface', async () => {
		const { ctx } = await renderCanvasRegion();
		const before = backend.resizes.length;
		FakeResizeObserver.instances[0].callback();
		expect(backend.resizes.length).toBe(before + 1);
		expect(ctx.renderer.framePending).toBe(true);
	});
});

describePlugin('renderer', renderer, {
	providers: [coreRegions, fakeCanvasKit],
	config: { frameDriver: new FakeFrameDriver(), createBackend: () => new FakeBackend() },
	contributes: ({ ctx }) => {
		expect(ctx.renderer).toBeDefined();
		expect(ctx.regions.contributions('canvas').map((entry) => entry.id)).toEqual([
			'renderer/canvas'
		]);
	}
});
