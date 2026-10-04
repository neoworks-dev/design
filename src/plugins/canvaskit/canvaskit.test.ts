import type { Context, Plugin } from '@neoworks/extension-system';
import type { CanvasKit, GrDirectContext } from 'canvaskit-wasm';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeWasmLocator } from '../../lib/renderer/canvaskit.node';
import { SkiaTracker } from '../../lib/renderer/ownership';
import { RenderSurface } from '../../lib/renderer/surface';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import canvaskit from './index';

const config = { locateFile: nodeWasmLocator() };

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountCanvasKit(): Promise<MountedPlugin> {
	mounted = await mountPlugin(canvaskit, { config });
	return mounted;
}

describe('canvaskit bootstrap', () => {
	it('is not active until the wasm is compiled, then the service is ready', async () => {
		const { ctx } = await mountCanvasKit();
		expect(ctx.canvaskit.isReady).toBe(true);
		expect(ctx.canvaskit.kit.ParagraphBuilder).toBeDefined();
	});

	it('draws a first frame of one solid color into an offscreen surface', async () => {
		const { ctx } = await mountCanvasKit();
		const { kit } = ctx.canvaskit;
		const surface = ctx.canvaskit.createOffscreenSurface(16, 16);
		const drawn = surface.frame((canvas) => canvas.clear(kit.Color(255, 128, 0, 1)));
		expect(drawn).toBe(true);
		const [red, green, blue, alpha] = surface.readPixels({ x: 8, y: 8, width: 1, height: 1 });
		expect([red, green, blue, alpha]).toEqual([255, 128, 0, 255]);
	});

	it('deletes the surface and leaves no live Skia objects when the calling plugin unloads', async () => {
		const { ctx } = await mountCanvasKit();
		const { tracker } = ctx.canvaskit;
		const consumer = {
			name: 'surface-consumer',
			inject: ['canvaskit'],
			apply(consumerContext: Context): void {
				consumerContext.canvaskit.createOffscreenSurface(8, 8);
			}
		} as Plugin;
		const fiber = await ctx.plugin(consumer);
		expect(tracker.liveCount).toBe(1);
		await fiber.dispose();
		expect(tracker.liveCount).toBe(0);
	});

	it('own() ties an object to the calling plugin and counts it as live', async () => {
		const { ctx } = await mountCanvasKit();
		const { kit, tracker } = ctx.canvaskit;
		const paint = ctx.canvaskit.own('test paint', () => new kit.Paint());
		expect(tracker.liveCount).toBe(1);
		paint.delete();
		expect(tracker.liveCount).toBe(0);
		paint.delete();
		expect(tracker.liveCount).toBe(0);
	});
});

describe('SkiaTracker', () => {
	it('counts tracked objects and deletes a scope newest first', async () => {
		const { ctx } = await mountCanvasKit();
		const { kit } = ctx.canvaskit;
		const tracker = new SkiaTracker();
		const scope = tracker.scope();
		scope.own(new kit.Paint());
		scope.own(new kit.Path());
		expect(tracker.liveCount).toBe(2);
		expect(tracker.createdCount).toBe(2);
		scope.dispose();
		expect(tracker.liveCount).toBe(0);
		expect(tracker.createdCount).toBe(2);
	});
});

interface GlHarness {
	kit: CanvasKit;
	element: HTMLCanvasElement;
	tracker: SkiaTracker;
	resets: string[];
	contextsCreated: () => number;
	abandoned: () => number;
	surface: RenderSurface;
}

// CanvasKit has no GPU in Node, so the GL entry points are faked on top of the real module: the
// "GL" surface is a raster surface, which is all the context-loss state machine needs.
async function glHarness(): Promise<GlHarness> {
	const { ctx } = await mountCanvasKit();
	const real = ctx.canvaskit.kit;
	let contexts = 0;
	let abandoned = 0;
	const fakeGrContext = (): GrDirectContext =>
		({
			delete: () => {},
			releaseResourcesAndAbandonContext: () => {
				abandoned += 1;
			}
		}) as unknown as GrDirectContext;
	const kit: CanvasKit = Object.assign(Object.create(real), {
		GetWebGLContext: () => {
			contexts += 1;
			return contexts;
		},
		MakeWebGLContext: fakeGrContext,
		MakeOnScreenGLSurface: (_context: unknown, width: number, height: number) =>
			real.MakeSurface(width, height),
		deleteContext: () => {}
	});
	const element = document.createElement('canvas');
	element.width = 32;
	element.height = 32;
	const tracker = new SkiaTracker();
	const resets: string[] = [];
	const surface = RenderSurface.forCanvas(kit, tracker, element, {
		onReset: (reason) => resets.push(reason)
	});
	return {
		kit,
		element,
		tracker,
		resets,
		contextsCreated: () => contexts,
		abandoned: () => abandoned,
		surface
	};
}

describe('WebGL context loss', () => {
	it('uses the WebGL path when a context can be made', async () => {
		const harness = await glHarness();
		expect(harness.surface.kind).toBe('webgl');
		expect(harness.surface.frame(() => {})).toBe(true);
		harness.surface.dispose();
	});

	it('skips frames while lost and rebuilds the surface on restore, reporting a reset', async () => {
		const harness = await glHarness();
		const { element, surface } = harness;
		const liveBefore = harness.tracker.liveCount;

		element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(surface.isLost).toBe(true);
		expect(surface.frame(() => {})).toBe(false);
		expect(harness.abandoned()).toBe(1);
		expect(harness.tracker.liveCount).toBe(0);

		element.dispatchEvent(new Event('webglcontextrestored'));
		expect(surface.isLost).toBe(false);
		expect(harness.resets).toEqual(['context-restored']);
		expect(harness.contextsCreated()).toBe(2);
		expect(harness.tracker.liveCount).toBe(liveBefore);
		expect(surface.frame((canvas) => canvas.clear(harness.kit.Color(0, 255, 0, 1)))).toBe(true);
		expect([...surface.readPixels({ x: 1, y: 1, width: 1, height: 1 })]).toEqual([0, 255, 0, 255]);

		surface.dispose();
		expect(harness.tracker.liveCount).toBe(0);
	});

	it('prevents the default of a lost event so the browser restores the context', async () => {
		const harness = await glHarness();
		const lost = new Event('webglcontextlost', { cancelable: true });
		harness.element.dispatchEvent(lost);
		expect(lost.defaultPrevented).toBe(true);
		harness.surface.dispose();
	});

	it('stops listening once disposed', async () => {
		const harness = await glHarness();
		harness.surface.dispose();
		harness.element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(harness.surface.isLost).toBe(false);
		expect(harness.tracker.liveCount).toBe(0);
	});

	it('resizing rebuilds the surface at the new pixel size and reports a reset', async () => {
		const harness = await glHarness();
		harness.surface.resize(64, 48);
		expect(harness.surface.width).toBe(64);
		expect(harness.element.height).toBe(48);
		expect(harness.resets).toEqual(['resize']);
		harness.surface.dispose();
		expect(harness.tracker.liveCount).toBe(0);
	});
});

describePlugin('canvaskit', canvaskit, {
	config,
	contributes: ({ ctx }) => {
		expect(ctx.canvaskit.isReady).toBe(true);
	}
});
