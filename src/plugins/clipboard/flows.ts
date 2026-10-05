// The asynchronous copy and paste flows of the clipboard plugin. Each takes the plugin's own
// `ctx`; the system clipboard is reached through `ctx.desktop` (main process), never directly.

import type { Context } from '@neoworks/extension-system';
import { looksLikeSvg, rasterizeSvg } from '../../lib/assets/svgRaster';
import type { Rect, Vec2 } from '../../lib/document';
import { applyEdit, objectArguments } from '../../lib/editing/contribute';
import {
	buildPayload,
	copyableIds,
	decodePayload,
	encodePayload,
	fallbackText
} from '../../lib/editing/clipboardPayload';
import { planDelete } from '../../lib/editing/nodeCommands';
import {
	buildImageNode,
	buildTextNode,
	planPaste,
	planPasteNode,
	type PasteMode,
	type PastePlan,
	type PasteSettings
} from '../../lib/editing/paste';

const PASTE_LABELS: Record<PasteMode, string> = {
	default: 'Paste',
	'in-place': 'Paste in place',
	'over-selection': 'Paste over selection',
	replace: 'Paste to replace',
	here: 'Paste here'
};

/** The world point a context menu was opened at, when its opener passed one as target. */
function cursorOf(args: unknown): Vec2 | null {
	const world = objectArguments(args).world;
	if (typeof world !== 'object' || world === null) return null;
	const point = world as Record<string, unknown>;
	if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
	return { x: point.x, y: point.y };
}

function visibleRect(ctx: Context): Rect | null {
	const size = ctx.viewport.size;
	if (size.width <= 0 || size.height <= 0) return null;
	return ctx.viewport.visibleRect();
}

function settingsFor(ctx: Context, mode: PasteMode, args: unknown): PasteSettings {
	return {
		mode,
		documentId: ctx.document.documentId,
		currentPageId: ctx.document.currentPageId,
		selection: ctx.selection.ids,
		viewport: visibleRect(ctx),
		cursor: cursorOf(args)
	};
}

/** Put the selection on the OS clipboard. Returns whether anything was copied. */
export async function copySelection(ctx: Context): Promise<boolean> {
	const reader = ctx.document.reader;
	const payload = buildPayload(reader, ctx.selection.ids);
	if (payload === null) return false;
	// A headless renderer plugin answers this waterfall with the PNG of the roots.
	const png = await ctx.waterfall(
		'clipboard/render-png',
		copyableIds(reader, ctx.selection.ids),
		() => Promise.resolve(null)
	);
	await ctx.desktop.clipboardWrite({
		html: encodePayload(payload),
		text: fallbackText(payload),
		png: png === null ? undefined : png
	});
	return true;
}

export async function cutSelection(ctx: Context): Promise<void> {
	if (!(await copySelection(ctx))) return;
	applyEdit(ctx, planDelete(ctx.document.reader, ctx.selection.ids), 'Cut');
}

async function planFromClipboard(
	ctx: Context,
	mode: PasteMode,
	args: unknown
): Promise<PastePlan | null> {
	const content = await ctx.desktop.clipboardRead();
	const payload = decodePayload(content.html);
	if (payload !== null)
		return planPaste(ctx.document.reader, payload, settingsFor(ctx, mode, args));
	if (content.png !== null) return planImage(ctx, content.png, mode, args);
	if (content.text !== null && looksLikeSvg(new TextEncoder().encode(content.text))) {
		return planSvgImage(ctx, content.text, mode, args);
	}
	if (content.text !== null && content.text.trim() !== '') {
		return planPasteNode(
			ctx.document.reader,
			buildTextNode(content.text),
			settingsFor(ctx, mode, args)
		);
	}
	return null;
}

/** SVG markup on the clipboard is pasted as an image (rasterised once), not as text. */
async function planSvgImage(
	ctx: Context,
	markup: string,
	mode: PasteMode,
	args: unknown
): Promise<PastePlan> {
	const png = await rasterizeSvg(new TextEncoder().encode(markup));
	return planImage(ctx, png, mode, args);
}

async function planImage(
	ctx: Context,
	bytes: Uint8Array,
	mode: PasteMode,
	args: unknown
): Promise<PastePlan> {
	const stored = await ctx.blobs.put(bytes);
	const settings = settingsFor(ctx, mode, args);
	const image = {
		hash: stored.hash,
		width: stored.info.width,
		height: stored.info.height
	};
	const node = buildImageNode(image, settings.viewport);
	return planPasteNode(ctx.document.reader, node, settings, stored.changes);
}

/** Paste what the clipboard holds with the rules of `mode`; the pasted nodes get selected. */
export async function pasteClipboard(ctx: Context, mode: PasteMode, args?: unknown): Promise<void> {
	const plan = await planFromClipboard(ctx, mode, args);
	if (plan === null) return;
	if (!applyEdit(ctx, plan.changes, PASTE_LABELS[mode])) return;
	ctx.selection.select(plan.newRootIds);
}
