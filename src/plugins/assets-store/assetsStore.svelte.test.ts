import { describe, expect, it, vi } from 'vitest';
import type { AssetPutRequest, DesktopBridge, FontRef } from '../../../electron/bridge';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import coreKeymap from '../core-keymap';
import coreRegions from '../core-regions';
import desktopBridge from '../desktop-bridge';
import documentPlugin from '../document';
import fontsPlugin from '../fonts';
import assetsStore from './index';

function png(width: number, height: number, salt: number): Uint8Array {
	const bytes = new Uint8Array(33);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
	const data = new DataView(bytes.buffer);
	data.setUint32(16, width);
	data.setUint32(20, height);
	bytes[32] = salt;
	return bytes;
}

interface Store {
	assets: Map<string, AssetPutRequest>;
	fonts: Map<string, Uint8Array>;
	gets: string[];
}

function fakeBridge(store: Store): Partial<DesktopBridge> {
	const assets: Partial<DesktopBridge['assets']> = {
		put: vi.fn((request: AssetPutRequest) => {
			const hash = `h${request.bytes[32]}`.padEnd(64, '0');
			const created = !store.assets.has(hash);
			store.assets.set(hash, request);
			return Promise.resolve({
				record: { id: hash, mime: request.mime, width: request.width, height: request.height },
				created
			});
		}),
		get: vi.fn((hash: string) => {
			store.gets.push(hash);
			return Promise.resolve(store.assets.get(hash)?.bytes ?? null);
		}),
		collect: vi.fn(() => Promise.resolve([])),
		embedFont: vi.fn((ref: FontRef, bytes: Uint8Array) => {
			store.fonts.set(`${ref.family}/${ref.style}`, bytes);
			return Promise.resolve();
		}),
		embeddedFonts: vi.fn(() =>
			Promise.resolve(
				[...store.fonts.keys()].map((key) => {
					const [family, style] = key.split('/');
					return { family, style };
				})
			)
		),
		fontBytes: vi.fn((ref: FontRef) =>
			Promise.resolve(store.fonts.get(`${ref.family}/${ref.style}`) ?? null)
		)
	};
	return {
		assets: assets as DesktopBridge['assets'],
		fonts: { list: () => Promise.resolve([]), load: () => Promise.resolve(null) }
	};
}

const providers = [
	coreRegions,
	coreContextKeys,
	coreKeymap,
	coreCommands,
	documentPlugin,
	desktopBridge,
	fontsPlugin
];

function newStore(): Store {
	return { assets: new Map(), fonts: new Map(), gets: [] };
}

describePlugin('assets-store', assetsStore, {
	providers,
	desktop: fakeBridge(newStore()),
	contributes: ({ ctx }) => {
		expect(ctx.blobs).toBeDefined();
	}
});

describe('blobs service', () => {
	it('stores an image once: the second put adds no document changes and reports not created', async () => {
		const mounted = await mountPlugin(assetsStore, { providers, desktop: fakeBridge(newStore()) });
		const { ctx } = mounted;
		const first = await ctx.blobs.put(png(40, 30, 1));
		expect(first).toMatchObject({ created: true, oversized: false });
		expect(first.record).toMatchObject({ mime: 'image/png', width: 40, height: 30 });
		expect(first.changes).toHaveLength(1);
		ctx.document.apply(first.changes, { origin: 'user', label: 'Import image' });
		expect(ctx.document.getEntity('asset', first.hash)).toEqual(first.record);

		const second = await ctx.blobs.put(png(40, 30, 1));
		expect(second.hash).toBe(first.hash);
		expect(second.created).toBe(false);
		expect(second.changes).toEqual([]);
		await mounted.cleanup();
	});

	it('flags images over the size policy and refuses non-images', async () => {
		const mounted = await mountPlugin(assetsStore, { providers, desktop: fakeBridge(newStore()) });
		const { ctx } = mounted;
		expect((await ctx.blobs.put(png(5000, 10, 2), { maxDimension: 4096 })).oversized).toBe(true);
		await expect(ctx.blobs.put(new Uint8Array([1, 2, 3]))).rejects.toThrow('not a supported image');
		await mounted.cleanup();
	});

	it('fetches bytes by hash once and serves repeats from the cache', async () => {
		const store = newStore();
		const mounted = await mountPlugin(assetsStore, { providers, desktop: fakeBridge(store) });
		const { ctx } = mounted;
		const bytes = png(8, 8, 3);
		const { hash } = await ctx.blobs.put(bytes);
		ctx.blobs.forgetCache();
		expect(await ctx.blobs.get(hash)).toEqual(bytes);
		expect(await ctx.blobs.get(hash)).toEqual(bytes);
		expect(store.gets).toEqual([hash]);
		await mounted.cleanup();
	});

	it('embeds a font through the fonts service and restores it when a file is attached', async () => {
		const store = newStore();
		const mounted = await mountPlugin(assetsStore, { providers, desktop: fakeBridge(store) });
		const { ctx } = mounted;
		const ref = { family: 'Brand Sans', style: 'Regular' };
		await ctx.blobs.embedFont(ref, new Uint8Array([0, 1, 0, 0]));
		expect(store.fonts.has('Brand Sans/Regular')).toBe(true);
		expect(ctx.fonts.faces().some((face) => face.family === 'Brand Sans')).toBe(true);

		await ctx.blobs.dispose();
		expect(ctx.fonts.faces().some((face) => face.family === 'Brand Sans')).toBe(false);
		ctx.emit('file/attached', {} as never);
		await vi.waitFor(() =>
			expect(ctx.fonts.faces().some((face) => face.family === 'Brand Sans')).toBe(true)
		);
		await mounted.cleanup();
	});
});
