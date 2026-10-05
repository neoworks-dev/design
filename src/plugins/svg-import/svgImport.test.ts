import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardWorld } from '../../lib/editing/fixtures/clipboardFixture';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import clipboard from '../clipboard';
import { importDroppedSvgs } from '../tool-image/dropImages';
import svgImport from './index';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60">
	<g id="icon"><rect x="5" y="5" width="30" height="20" fill="#f00"/><path d="M40 10 L70 10 L55 50 Z" fill="blue"/></g>
	<clipPath id="c"/><rect width="10" height="10" clip-path="url(#c)"/>
</svg>`;

describePlugin('svg-import', svgImport, {
	providers: editingProviders(),
	contributes: ({ ctx }) => {
		const payload = ctx.waterfall('clipboard/svg-payload', SVG, 'icon', () => null);
		expect(payload?.nodes[0]).toMatchObject({ type: 'FRAME', name: 'icon', width: 80, height: 60 });
		expect(ctx.waterfall('clipboard/svg-payload', 'not svg', undefined, () => null)).toBeNull();
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

function pasteWithCtrlV(ctx: Context): void {
	ctx.keymap.handleKeydown({
		key: 'v',
		ctrlKey: true,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false
	});
}

async function mountPasteWorld(): Promise<{
	ctx: Context;
	write: (text: string) => Promise<void>;
}> {
	const world = clipboardWorld();
	mounted = await mountPlugin(clipboard, { providers: [...world.providers, svgImport] });
	mounted.ctx.keymap.pushScope('canvas');
	return { ctx: mounted.ctx, write: (text) => world.bridge.clipboard.write({ text }) };
}

function typesOf(ctx: Context, rootId: string): string[] {
	return [rootId, ...ctx.document.reader.descendants(rootId).map((node) => node.id)].map(
		(id) => ctx.document.require(id).type
	);
}

describe('paste', () => {
	it('pastes SVG text as a frame of vector layers, centred in the viewport, one undo step', async () => {
		const { ctx, write } = await mountPasteWorld();
		await write(SVG);
		pasteWithCtrlV(ctx);
		await vi.waitFor(() => expect(ctx.selection.count).toBe(1));
		const [rootId] = ctx.selection.ids;
		expect(typesOf(ctx, rootId)).toEqual(['FRAME', 'GROUP', 'RECTANGLE', 'VECTOR', 'RECTANGLE']);
		const frame = ctx.document.require(rootId);
		expect(frame).toMatchObject({ type: 'FRAME', width: 80, height: 60 });
		// the clipboard viewport is 1000,1000 800x600: the paste lands in its middle
		expect(ctx.document.absoluteBounds(rootId)).toMatchObject({ x: 1360, y: 1270 });
		expect(ctx.document.getEntity('asset', 'hash-5')).toBeUndefined();
		expect(ctx.history.undoLabel).toBe('Paste');
		ctx.history.undo();
		expect(ctx.document.has(rootId)).toBe(false);
		expect(ctx.history.canUndo).toBe(false);
	});

	it('reports what it could not import on svg-import/warnings', async () => {
		const { ctx, write } = await mountPasteWorld();
		const warnings: string[][] = [];
		ctx.on('svg-import/warnings', (entries) => void warnings.push(entries));
		await write(SVG);
		pasteWithCtrlV(ctx);
		await vi.waitFor(() => expect(ctx.selection.count).toBe(1));
		expect(warnings).toEqual([['clip-path is not imported']]);
	});
});

describe('drop', () => {
	it('imports dropped .svg files at the drop point, side by side, and leaves other files', async () => {
		const { ctx } = await mountPasteWorld();
		const png = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
		const first = new File([SVG], 'first.svg', { type: 'image/svg+xml' });
		const second = new File([SVG], 'second.svg');
		const BEFORE = ctx.document.children(ctx.document.currentPageId).length;
		const rest = await importDroppedSvgs(ctx, [first, png, second], { x: 500, y: 300 });
		expect(rest).toEqual([png]);
		const frames = ctx.document
			.children(ctx.document.currentPageId)
			.map((id) => ctx.document.require(id))
			.filter((node) => node.type === 'FRAME' && (node.name === 'first' || node.name === 'second'));
		expect(frames.map((frame) => frame.name)).toEqual(['first', 'second']);
		const [one, two] = frames.map((frame) => ctx.document.absoluteBounds(frame.id));
		expect(one.x + one.width / 2).toBeCloseTo(500, 6);
		expect(one.y + one.height / 2).toBeCloseTo(300, 6);
		expect(two.x).toBeGreaterThan(one.x + one.width);
		ctx.history.undo();
		expect(ctx.document.children(ctx.document.currentPageId)).toHaveLength(BEFORE + 1);
		ctx.history.undo();
		expect(ctx.document.children(ctx.document.currentPageId)).toHaveLength(BEFORE);
	});

	it('returns the file for the image path when no importer answers', async () => {
		const world = clipboardWorld();
		mounted = await mountPlugin(clipboard, { providers: world.providers });
		const svgFile = new File([SVG], 'icon.svg');
		expect(await importDroppedSvgs(mounted.ctx, [svgFile], { x: 0, y: 0 })).toEqual([svgFile]);
	});
});
