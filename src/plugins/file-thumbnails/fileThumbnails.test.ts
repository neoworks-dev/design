import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, Thumbnail } from '../../../electron/bridge';
import { buildDocument, frame, page } from '../../lib/document/fixtures';
import { pickThumbnailNode, thumbnailScale, THUMBNAIL_MAX_SIDE } from '../../lib/home/thumbnail';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import desktopBridge from '../desktop-bridge';
import fileThumbnails from './index';

interface Fakes {
	providers: Plugin[];
	exportNode: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
	path: { current: string };
}

function fakes(withContent: boolean): Fakes {
	const content = [];
	if (withContent) content.push(frame({ name: 'Home', width: 960, height: 480 }));
	const document = buildDocument([page('One', content)]);
	const path = { current: '/docs/a.ndesign' };
	const exportNode = vi.fn(() =>
		Promise.resolve({
			bytes: new Uint8Array([1, 2, 3]),
			width: 480,
			height: 240,
			format: 'PNG',
			mimeType: 'image/png'
		})
	);
	const renderer: Plugin = {
		name: 'headless-renderer',
		inject: [],
		apply: (ctx: Context) => void ctx.provide('headlessRenderer', { exportNode })
	} as Plugin;
	const session: Plugin = {
		name: 'file-session',
		inject: [],
		apply: (ctx: Context) =>
			void ctx.provide('fileSession', {
				get info() {
					return { path: path.current };
				}
			})
	} as Plugin;
	return {
		providers: [...editingProviders(document), desktopBridge, renderer, session],
		exportNode,
		path
	};
}

function bridgeWith(setThumbnail: (thumbnail: Thumbnail) => Promise<void>): Partial<DesktopBridge> {
	const files: Partial<DesktopBridge['files']> = { setThumbnail };
	return { files: files as DesktopBridge['files'] };
}

describePlugin('file-thumbnails', fileThumbnails, {
	providers: fakes(true).providers,
	desktop: bridgeWith(() => Promise.resolve()),
	contributes: ({ ctx }) => {
		expect(ctx.fiber.getEffects().length).toBeGreaterThan(0);
	}
});

describe('thumbnail on save', () => {
	it('draws the first frame small and stores it in the open file', async () => {
		const stored: Thumbnail[] = [];
		const { providers, exportNode } = fakes(true);
		const mounted = await mountPlugin(fileThumbnails, {
			providers,
			desktop: bridgeWith((thumbnail) => {
				stored.push(thumbnail);
				return Promise.resolve();
			})
		});
		mounted.ctx.emit('file/saved', {} as never);
		await vi.waitFor(() => expect(stored).toHaveLength(1));
		expect(exportNode).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ scale: 0.5, format: 'PNG', useAbsoluteBounds: true })
		);
		expect(stored[0]).toEqual({
			mime: 'image/png',
			width: 480,
			height: 240,
			bytes: new Uint8Array([1, 2, 3])
		});
		await mounted.cleanup();
	});

	it('stores nothing for an empty page', async () => {
		const setThumbnail = vi.fn(() => Promise.resolve());
		const { providers, exportNode } = fakes(false);
		const mounted = await mountPlugin(fileThumbnails, {
			providers,
			desktop: bridgeWith(setThumbnail)
		});
		mounted.ctx.emit('file/saved', {} as never);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(exportNode).not.toHaveBeenCalled();
		expect(setThumbnail).not.toHaveBeenCalled();
		await mounted.cleanup();
	});

	it('drops the image when another file became current while it was drawn', async () => {
		const setThumbnail = vi.fn(() => Promise.resolve());
		const { providers, exportNode, path } = fakes(true);
		exportNode.mockImplementation(() => {
			path.current = '/docs/b.ndesign';
			return Promise.resolve({
				bytes: new Uint8Array([1]),
				width: 1,
				height: 1,
				format: 'PNG',
				mimeType: 'image/png'
			});
		});
		const mounted = await mountPlugin(fileThumbnails, {
			providers,
			desktop: bridgeWith(setThumbnail)
		});
		mounted.ctx.emit('file/saved', {} as never);
		await vi.waitFor(() => expect(exportNode).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(setThumbnail).not.toHaveBeenCalled();
		await mounted.cleanup();
	});
});

describe('thumbnail helpers', () => {
	const node = (id: string, type: string, width = 10, height = 10): never =>
		({ id, type, width, height }) as never;

	it('prefers the first frame, else the first node, else nothing', () => {
		expect(
			pickThumbnailNode({ topLevel: () => [node('r', 'RECTANGLE'), node('f', 'FRAME')] })
		).toBe('f');
		expect(pickThumbnailNode({ topLevel: () => [node('r', 'RECTANGLE')] })).toBe('r');
		expect(pickThumbnailNode({ topLevel: () => [node('z', 'FRAME', 0, 10)] })).toBeUndefined();
		expect(pickThumbnailNode({ topLevel: () => [] })).toBeUndefined();
	});

	it('fits the longest side and never magnifies', () => {
		expect(thumbnailScale(THUMBNAIL_MAX_SIDE * 4, 100)).toBe(0.25);
		expect(thumbnailScale(100, 50)).toBe(1);
		expect(thumbnailScale(0, 0)).toBe(1);
	});
});
