import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserBridge, type BrowserBridge } from '../../lib/desktop/browserBridge';
import {
	createNode,
	type AssetRecord,
	type ImagePaint,
	type Matrix2x3,
	type NodeId
} from '../../lib/document';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { imageSizeOf } from '../../lib/editing/imageCrop';
import { prepareImage } from '../../lib/editing/placeImages';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { selectionScene } from '../../lib/selecting/fixtures/selectionFixture';
import type { ResizeGesture } from '../../lib/selecting/resizeGesture';
import type { ToolPointerEvent } from '../../lib/tools/protocol';
import coreTools from '../core-tools';
import desktopBridge from '../desktop-bridge';
import hitTest from '../hit-test';
import snapping from '../snapping';
import spatial from '../spatial';
import toolMove from '../tool-move';
import transformHandles from '../transform-handles';
import { dropImages, isImageFile } from './dropImages';
import toolImage from './index';

const IMAGE_SIZE = { width: 40, height: 20 };

class StubBlobs extends Service {
	constructor(ctx: Context) {
		super(ctx, 'blobs');
	}

	put(bytes: Uint8Array): Promise<unknown> {
		const record: AssetRecord = { id: `hash-${bytes.length}`, mime: 'image/png', ...IMAGE_SIZE };
		const existing = this.ctx.document.getEntity('asset', record.id);
		let changes: unknown[] = [];
		if (existing === undefined) changes = this.ctx.document.addEntity('asset', record);
		return Promise.resolve({
			hash: record.id,
			record,
			created: existing === undefined,
			changes,
			oversized: false,
			info: { mime: 'image/png', ...IMAGE_SIZE }
		});
	}
}

const fakeViewport: Plugin = {
	name: 'viewport',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('viewport', {
			zoom: 1,
			size: { width: 800, height: 600 },
			camera: { x: 0, y: 0, scale: 1 },
			visibleRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
			worldToScreen: (point: { x: number; y: number }) => point,
			screenToWorld: (point: { x: number; y: number }) => point
		});
	}
};

const fakeRenderer: Plugin = {
	name: 'renderer',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('renderer', { canvasElement: undefined });
	}
};

const stubBlobs: Plugin = {
	name: 'blobs',
	inject: ['document'],
	apply(ctx: Context): void {
		new StubBlobs(ctx);
	}
};

function providers(bridge: BrowserBridge): Plugin[] {
	return [
		...editingProviders(selectionScene()),
		coreTools,
		spatial,
		hitTest,
		snapping,
		fakeViewport,
		fakeRenderer,
		{ ...desktopBridge, apply: (ctx: Context) => desktopBridge.apply(ctx, { bridge }) },
		stubBlobs
	];
}

describePlugin('tool-image', toolImage, {
	providers: providers(createBrowserBridge()),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('image')).toBeDefined();
		expect(ctx.tools.get('image-crop')).toBeDefined();
		expect(ctx.commands.has('image.place')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('ctrl+shift+k');
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'tool-image/crop-handles'
		);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountImage(extra: Plugin[] = []): Promise<{ ctx: Context; bridge: BrowserBridge }> {
	const bridge = createBrowserBridge();
	mounted = await mountPlugin(toolImage, { providers: [...providers(bridge), ...extra] });
	return { ctx: mounted.ctx, bridge };
}

function pointer(x: number, y: number): ToolPointerEvent {
	return {
		screen: { x, y },
		world: { x, y },
		button: 0,
		detail: 1,
		pointerId: 1,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false
	};
}

function fakeBytes(length: number): Uint8Array {
	return new Uint8Array(length);
}

function assetCount(ctx: Context): number {
	let count = 0;
	for (const id of ['hash-10', 'hash-11', 'hash-12']) {
		if (ctx.document.getEntity('asset', id) !== undefined) count += 1;
	}
	return count;
}

function imageHashOf(ctx: Context, id: NodeId): string {
	const node = ctx.document.require(id);
	if (!('fills' in node)) throw new Error('no fills');
	const paint = node.fills.find((candidate) => candidate.type === 'IMAGE');
	if (paint === undefined) throw new Error('no image fill');
	return paint.imageHash;
}

describe('file picker and the image tool', () => {
	it('Ctrl+Shift+K picks files, a click places them in a row in one undo step', async () => {
		const { ctx, bridge } = await mountImage();
		bridge.dialogs.openImages = () =>
			Promise.resolve([
				{ name: 'first.png', bytes: fakeBytes(10) },
				{ name: 'second.jpg', bytes: fakeBytes(11) }
			]);
		await ctx.commands.run('image.place');
		await vi.waitFor(() => expect(ctx.tools.activeId()).toBe('image'));

		ctx.tools.pointerDown(pointer(2000, 100));
		ctx.tools.pointerUp(pointer(2000, 100));

		expect(ctx.selection.ids).toHaveLength(2);
		const [first, second] = ctx.selection.ids;
		expect(ctx.document.require(first)).toMatchObject({ name: 'first', width: 40, height: 20 });
		expect(ctx.document.require(second)).toMatchObject({ name: 'second' });
		expect(ctx.document.absoluteBounds(first)).toMatchObject({ x: 2000, y: 100 });
		expect(ctx.document.absoluteBounds(second)).toMatchObject({ x: 2064, y: 100 });
		expect(imageHashOf(ctx, first)).toBe('hash-10');
		expect(assetCount(ctx)).toBe(2);
		expect(ctx.tools.activeId()).toBe('move');

		expect(ctx.history.undoLabel).toBe('Place images');
		ctx.history.undo();
		expect(ctx.document.has(first)).toBe(false);
		expect(assetCount(ctx)).toBe(0);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('a drag sizes the first image to the dragged box', async () => {
		const { ctx, bridge } = await mountImage();
		bridge.dialogs.openImages = () =>
			Promise.resolve([{ name: 'wide.webp', bytes: fakeBytes(12) }]);
		await ctx.commands.run('image.place');
		await vi.waitFor(() => expect(ctx.tools.activeId()).toBe('image'));
		ctx.tools.pointerDown(pointer(2000, 100));
		ctx.tools.pointerMove(pointer(2200, 180));
		ctx.tools.pointerUp(pointer(2200, 180));
		const [id] = ctx.selection.ids;
		expect(ctx.document.require(id)).toMatchObject({ width: 200, height: 80 });
	});

	it('Esc cancels the pending images and a cancelled dialog does nothing', async () => {
		const { ctx, bridge } = await mountImage();
		await ctx.commands.run('image.place');
		expect(ctx.tools.activeId()).toBe('move');
		bridge.dialogs.openImages = () => Promise.resolve([{ name: 'a.png', bytes: fakeBytes(10) }]);
		await ctx.commands.run('image.place');
		await vi.waitFor(() => expect(ctx.tools.activeId()).toBe('image'));
		ctx.tools.cancel();
		expect(ctx.tools.activeId()).toBe('move');
		expect(ctx.history.canUndo).toBe(false);
	});
});

describe('drop', () => {
	async function prepared(ctx: Context): Promise<ReturnType<typeof prepareImage>> {
		return prepareImage(ctx, 'dropped.png', fakeBytes(10));
	}

	it('fills the leaf shape under the pointer, replacing its fills, one undo step', async () => {
		const { ctx } = await mountImage();
		dropImages(ctx, [await prepared(ctx)], { x: 950, y: 50 }, { altKey: false });
		expect(imageHashOf(ctx, 'L')).toBe('hash-10');
		expect(ctx.selection.ids).toEqual(['L']);
		ctx.history.undo();
		const original = ctx.document.require('L');
		expect(original.type === 'RECTANGLE' && original.fills[0].type).toBe('SOLID');
		expect(assetCount(ctx)).toBe(0);
	});

	it('Alt, a frame or empty canvas place a new image rectangle instead', async () => {
		const { ctx } = await mountImage();
		dropImages(ctx, [await prepared(ctx)], { x: 950, y: 50 }, { altKey: true });
		const [created] = ctx.selection.ids;
		expect(created).not.toBe('L');
		expect(ctx.document.require(created)).toMatchObject({ name: 'dropped', parentId: 'p' });

		dropImages(ctx, [await prepared(ctx)], { x: 450, y: 450 }, { altKey: false });
		expect(ctx.document.require(ctx.selection.ids[0]).parentId).toBe('p');

		dropImages(ctx, [await prepared(ctx)], { x: 300, y: 300 }, { altKey: false });
		expect(ctx.document.require(ctx.selection.ids[0]).parentId).toBe('NF');
	});

	it('recognises image files by type or extension', () => {
		expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
		expect(isImageFile(new File([], 'logo.SVG'))).toBe(true);
		expect(isImageFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(false);
	});
});

describe('svg as image', () => {
	it('rasterises SVG bytes before storing them', async () => {
		const { ctx } = await mountImage();
		const rasterize = vi.fn(() => Promise.resolve(fakeBytes(12)));
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8"/>');
		const image = await prepareImage(ctx, 'logo.svg', svg, rasterize);
		expect(rasterize).toHaveBeenCalledOnce();
		expect(image).toMatchObject({ name: 'logo', hash: 'hash-12' });
		const png = await prepareImage(ctx, 'photo.png', fakeBytes(10), rasterize);
		expect(png.hash).toBe('hash-10');
		expect(rasterize).toHaveBeenCalledOnce();
	});
});

describe('crop', () => {
	const NONE = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

	function addImageNode(ctx: Context): NodeId {
		const record: AssetRecord = { id: 'crop-image', mime: 'image/png', width: 200, height: 100 };
		const fill: ImagePaint = {
			type: 'IMAGE',
			visible: true,
			opacity: 1,
			blendMode: 'NORMAL',
			imageHash: 'crop-image',
			scaleMode: 'FILL'
		};
		const transform: Matrix2x3 = [
			[1, 0, 2000],
			[0, 1, 0]
		];
		const node = createNode('RECTANGLE', {
			name: 'Photo',
			parentId: 'p',
			index: 'zz',
			transform,
			width: 100,
			height: 100,
			fills: [fill]
		});
		const changes = [...ctx.document.addEntity('asset', record), ...ctx.document.insertNode(node)];
		ctx.document.apply(changes, { origin: 'user', label: 'Add image' });
		ctx.history.clear();
		return node.id;
	}

	it('Alt+double click asks for the crop mode and the mode starts on the image', async () => {
		const { ctx } = await mountImage([toolMove]);
		const id = addImageNode(ctx);
		ctx.selection.select([id]);
		ctx.tools.activate('move');
		const alt = { ...pointer(2050, 50), altKey: true, detail: 2 };
		ctx.tools.pointerDown(alt);
		expect(ctx.tools.activeId()).toBe('image-crop');
		expect(ctx.selection.ids).toEqual([id]);
	});

	it('dragging inside slides the image: one undo step, blob and size untouched', async () => {
		const { ctx } = await mountImage([toolMove]);
		const id = addImageNode(ctx);
		ctx.emit('canvas/edit-request', id, 'crop');
		expect(ctx.tools.activeId()).toBe('image-crop');
		ctx.tools.pointerDown(pointer(2050, 50));
		ctx.tools.pointerMove(pointer(2070, 50));
		ctx.tools.pointerUp(pointer(2070, 50));
		const node = ctx.document.require(id);
		const paint = node.type === 'RECTANGLE' && node.fills[0];
		expect(paint && paint.type === 'IMAGE' && paint.scaleMode).toBe('CROP');
		expect(paint && paint.type === 'IMAGE' && paint.imageHash).toBe('crop-image');
		expect(node).toMatchObject({ width: 100, height: 100 });
		expect(ctx.history.undoLabel).toBe('Move image');
		ctx.history.undo();
		const restored = ctx.document.require(id);
		expect(restored.type === 'RECTANGLE' && restored.fills[0]).toMatchObject({ scaleMode: 'FILL' });
		expect(ctx.history.canUndo).toBe(false);
	});

	it('Esc leaves the mode; a click outside the box leaves it too', async () => {
		const { ctx } = await mountImage([toolMove]);
		const id = addImageNode(ctx);
		ctx.emit('canvas/edit-request', id, 'crop');
		ctx.tools.cancel();
		expect(ctx.tools.activeId()).toBe('move');
		ctx.emit('canvas/edit-request', id, 'crop');
		ctx.tools.pointerDown(pointer(100, 100));
		expect(ctx.tools.activeId()).toBe('move');
	});

	it('Ctrl+resize crops with the transform handles and keeps the asset', async () => {
		const { ctx } = await mountImage([toolMove, transformHandles]);
		const id = addImageNode(ctx);
		ctx.selection.select([id]);
		const entry = ctx.regions.registry
			.list()
			.find((candidate) => candidate.id === 'transform-handles/overlay');
		const gesture = entry?.props?.gesture as ResizeGesture;
		gesture.begin('e', { x: 2100, y: 50 });
		gesture.update({ x: 2060, y: 50 }, { ...NONE, ctrlKey: true });
		gesture.commit();
		const node = ctx.document.require(id);
		expect(node).toMatchObject({ width: 60, height: 100 });
		const paint = node.type === 'RECTANGLE' && node.fills[0];
		expect(paint && paint.type === 'IMAGE' && paint.scaleMode).toBe('CROP');
		expect(imageSizeOf(ctx.document.reader, node)).toEqual({ width: 200, height: 100 });
		ctx.history.undo();
		expect(ctx.document.require(id)).toMatchObject({ width: 100 });
		expect(ctx.history.canUndo).toBe(false);
	});
});
