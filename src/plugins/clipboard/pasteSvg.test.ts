import type { Context } from '@neoworks/extension-system';
import { describe, expect, it, vi } from 'vitest';
import { clipboardWorld } from '../../lib/editing/fixtures/clipboardFixture';
import { mountPlugin } from '../../lib/kernel/testing';
import clipboard from '.';

// Rasterising needs a browser canvas; the test answers with fixed PNG-sized bytes.
vi.mock('../../lib/assets/svgRaster', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../lib/assets/svgRaster')>();
	return { ...original, rasterizeSvg: () => Promise.resolve(new Uint8Array([1, 2, 3, 4, 5])) };
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

describe('paste SVG markup', () => {
	it('pastes SVG text as an image rectangle (not as a text node), one undo step', async () => {
		const world = clipboardWorld();
		const mounted = await mountPlugin(clipboard, { providers: world.providers });
		const { ctx } = mounted;
		ctx.keymap.pushScope('canvas');
		await world.bridge.clipboard.write({
			text: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'
		});
		pasteWithCtrlV(ctx);
		await vi.waitFor(() => expect(ctx.selection.count).toBe(1));
		const [id] = ctx.selection.ids;
		expect(ctx.document.get(id)).toMatchObject({ type: 'RECTANGLE', name: 'Image' });
		expect(ctx.document.getEntity('asset', 'hash-5')).toBeDefined();
		ctx.history.undo();
		expect(ctx.document.has(id)).toBe(false);
		await mounted.cleanup();
	});
});
