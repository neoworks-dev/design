import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { FrameDriver } from '../../lib/renderer/frameScheduler';
import type { OverlayFrame } from '../../lib/overlay/types';
import { drawSnapOverlay } from '../../lib/snapping/overlayDraw';
import coreRegions from '../core-regions';
import overlay from './index';

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

const fakeViewport = {
	name: 'fake-viewport',
	inject: [],
	apply: (ctx: Context) => void ctx.provide('viewport', { camera: { x: 10, y: 20, scale: 2 } })
} as Plugin;

function providers(): Plugin[] {
	return [coreRegions, fakeViewport];
}

describePlugin('overlay', overlay, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.overlay).toBeDefined();
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'overlay/canvas'
		);
	}
});

function emptyContext(): CanvasRenderingContext2D {
	const target: object = {};
	return Object.assign(Object.create(null), target);
}

/** A canvas whose 2D context records calls instead of drawing. */
function recordingCanvas(): {
	canvas: HTMLCanvasElement;
	calls: string[];
	context: CanvasRenderingContext2D;
} {
	const calls: string[] = [];
	const context = new Proxy(emptyContext(), {
		get: (_target, property) => {
			if (property === 'measureText') return () => ({ width: 10 });
			return (...args: unknown[]) => calls.push(`${String(property)}(${args.join(',')})`);
		},
		set: () => true
	});
	const canvas = document.createElement('canvas');
	Reflect.set(canvas, 'getContext', () => context);
	return { canvas, calls, context };
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountOverlay(driver: ManualDriver): Promise<Context> {
	mounted = await mountPlugin(overlay, {
		providers: providers(),
		config: { frameDriver: driver }
	});
	return mounted.ctx;
}

describe('overlay service', () => {
	it('draws a registered contribution on the next frame and stops after dispose', async () => {
		const driver = new ManualDriver();
		const ctx = await mountOverlay(driver);
		const { canvas } = recordingCanvas();
		ctx.overlay.attachCanvas(canvas);
		const drawn: number[] = [];
		const dispose = ctx.overlay.register({
			id: 'test/one',
			draw: (frame) => drawn.push(frame.camera.scale)
		});
		driver.tick();
		expect(drawn).toEqual([2]);
		dispose();
		expect(ctx.overlay.framePending).toBe(true);
		driver.tick();
		expect(drawn).toEqual([2]);
		expect(ctx.overlay.registry.has('test/one')).toBe(false);
	});

	it('draws in order and maps world to screen through the camera', async () => {
		const driver = new ManualDriver();
		const ctx = await mountOverlay(driver);
		ctx.overlay.attachCanvas(recordingCanvas().canvas);
		const order: string[] = [];
		ctx.overlay.register({ id: 'top', order: 5, draw: () => order.push('top') });
		ctx.overlay.register({
			id: 'bottom',
			order: -5,
			draw: (frame) => {
				order.push('bottom');
				expect(frame.worldToScreen({ x: 1, y: 1 })).toEqual({ x: 12, y: 22 });
				expect(frame.worldRectToScreen({ x: 0, y: 0, width: 3, height: 4 })).toEqual({
					x: 10,
					y: 20,
					width: 6,
					height: 8
				});
			}
		});
		driver.tick();
		expect(order).toEqual(['bottom', 'top']);
	});

	it('requests a frame on viewport and selection events, coalesced to one', async () => {
		const driver = new ManualDriver();
		const ctx = await mountOverlay(driver);
		ctx.overlay.attachCanvas(recordingCanvas().canvas);
		driver.tick();
		const before = ctx.overlay.frames;
		ctx.emit('viewport/change', { x: 0, y: 0, scale: 1 });
		ctx.emit('selection/change', ['a'], []);
		driver.tick();
		expect(ctx.overlay.frames).toBe(before + 1);
	});

	it('keeps drawing the other contributions when one throws', async () => {
		const driver = new ManualDriver();
		const ctx = await mountOverlay(driver);
		ctx.overlay.attachCanvas(recordingCanvas().canvas);
		let survived = false;
		ctx.overlay.register({
			id: 'broken',
			order: 0,
			draw: () => {
				throw new Error('boom');
			}
		});
		ctx.overlay.register({ id: 'fine', order: 1, draw: () => (survived = true) });
		driver.tick();
		expect(survived).toBe(true);
	});

	it('sizes the canvas in device pixels and draws in CSS pixels', async () => {
		const driver = new ManualDriver();
		const ctx = await mountOverlay(driver);
		const { canvas, calls } = recordingCanvas();
		ctx.overlay.attachCanvas(canvas);
		ctx.overlay.register({ id: 'test/size', draw: () => {} });
		ctx.overlay.resize(400, 300, 2);
		driver.tick();
		expect([canvas.width, canvas.height]).toEqual([800, 600]);
		expect(calls).toContain('scale(2,2)');
	});
});

describe('snap overlay drawing', () => {
	function frameOn(context: CanvasRenderingContext2D): OverlayFrame {
		return {
			ctx: context,
			camera: { x: 0, y: 0, scale: 8 },
			size: { width: 100, height: 100 },
			devicePixelRatio: 1,
			worldToScreen: (point) => ({ x: point.x * 8, y: point.y * 8 }),
			worldRectToScreen: (rect) => ({
				x: rect.x * 8,
				y: rect.y * 8,
				width: rect.width * 8,
				height: rect.height * 8
			})
		};
	}

	it('draws nothing without guides, gaps or a measurement', () => {
		const { context, calls } = recordingCanvas();
		drawSnapOverlay(frameOn(context), { guides: [], gaps: [], measurement: null });
		expect(calls).toEqual([]);
	});

	it('strokes a guide at half-pixel positions in screen space', () => {
		const { context, calls } = recordingCanvas();
		drawSnapOverlay(frameOn(context), {
			guides: [{ axis: 'x', position: 5, start: 0, end: 10, markers: [] }],
			gaps: [],
			measurement: null
		});
		expect(calls).toContain('moveTo(40.5,0.5)');
		expect(calls).toContain('lineTo(40.5,80.5)');
		expect(calls).toContain('stroke()');
	});

	it('labels a gap with its page distance, not its screen length', () => {
		const { context, calls } = recordingCanvas();
		drawSnapOverlay(frameOn(context), {
			guides: [],
			gaps: [{ axis: 'x', start: 0, end: 12, cross: 3, distance: 12 }],
			measurement: null
		});
		expect(calls.some((call) => call.startsWith('fillText(12,'))).toBe(true);
	});
});
