import type { Context, Plugin } from '@neoworks/extension-system';
import type { Image } from 'canvaskit-wasm';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { SkiaTracker } from '../../lib/renderer/ownership';
import imageCache from './index';

class FakeImage {
	deleted = false;

	width(): number {
		return 100;
	}

	height(): number {
		return 100;
	}

	delete(): void {
		this.deleted = true;
	}
}

interface Fakes {
	images: FakeImage[];
	stored: Map<string, Uint8Array>;
	requests: string[];
}

function fakes(): Fakes {
	return { images: [], stored: new Map([['one', new Uint8Array([1])]]), requests: [] };
}

function providersFor(state: Fakes): Plugin[] {
	const fakeBlobs = {
		name: 'fake-blobs',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('blobs', {
				get(hash: string): Promise<Uint8Array | null> {
					state.requests.push(hash);
					return Promise.resolve(state.stored.get(hash) ?? null);
				}
			});
			ctx.provide('canvaskit', { kit: {}, tracker: new SkiaTracker() });
		}
	} as Plugin;
	return [fakeBlobs];
}

function configured(state: Fakes): Plugin {
	return {
		...imageCache,
		apply: (ctx: Context) =>
			imageCache.apply(ctx, {
				budgetMegabytes: 1,
				decode: () => {
					const image = new FakeImage();
					state.images.push(image);
					return Promise.resolve(image as unknown as Image);
				}
			})
	} as Plugin;
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('image-cache', () => {
	it('decodes on first use, asks the renderer for a frame, then serves the image', async () => {
		const state = fakes();
		mounted = await mountPlugin(configured(state), { providers: providersFor(state) });
		const { ctx } = mounted;
		const frames: string[] = [];
		ctx.on('renderer/need-frame', (reason) => frames.push(reason));
		expect(ctx.images.peek('one')).toBeUndefined();
		expect(ctx.images.status('one')).toBe('loading');
		await settle();
		expect(frames).toEqual(['image-ready']);
		expect(ctx.images.peek('one')).toBe(state.images[0]);
		expect(state.requests).toEqual(['one']);
	});

	it('reports a hash the file does not hold as missing and still asks for a frame', async () => {
		const state = fakes();
		mounted = await mountPlugin(configured(state), { providers: providersFor(state) });
		const { ctx } = mounted;
		const frames: string[] = [];
		ctx.on('renderer/need-frame', (reason) => frames.push(reason));
		expect(ctx.images.peek('absent')).toBeUndefined();
		await settle();
		expect(ctx.images.status('absent')).toBe('missing');
		expect(frames).toEqual(['image-ready']);
	});

	it('drops decoded images when a file is attached and when unloaded', async () => {
		const state = fakes();
		mounted = await mountPlugin(configured(state), { providers: providersFor(state) });
		const { ctx, fiber } = mounted;
		ctx.images.peek('one');
		await settle();
		ctx.emit('file/attached', { path: null } as never);
		expect(state.images[0].deleted).toBe(true);
		ctx.images.peek('one');
		await settle();
		expect(state.images).toHaveLength(2);
		await fiber.dispose();
		expect(state.images[1].deleted).toBe(true);
	});
});

const standardState = fakes();

describePlugin('image-cache', configured(standardState), {
	providers: providersFor(standardState),
	contributes: ({ ctx }) => {
		expect(ctx.images.budgetBytes).toBe(1024 * 1024);
	}
});
