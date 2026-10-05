// Turns a frame into what the player displays: one picture of the whole frame, or, for a frame
// that scrolls, one picture per child so the content can move inside the frame while the fixed
// children stay put. The pictures come from the headless renderer (the same draw hooks as the
// canvas); this module only decides what to render and where it goes.

import type { DocumentReader, NodeId, Paint, Rect } from '../document';
import { fixedChildIds, hotspotsOf, type Hotspot } from './hotspots';

export interface RenderedLayer {
	url: string;
	/** Relative to the frame's top-left corner. */
	x: number;
	y: number;
	width: number;
	height: number;
	fixed: boolean;
}

export interface RenderedFrame {
	frameId: NodeId;
	width: number;
	height: number;
	background: string | null;
	scrollX: boolean;
	scrollY: boolean;
	/** Extent of the scrolling content, at least the frame size. */
	contentWidth: number;
	contentHeight: number;
	layers: RenderedLayer[];
	hotspots: Hotspot[];
}

export interface FrameRenderEnvironment {
	reader: DocumentReader;
	boundsOf(id: NodeId): Rect;
	renderBoundsOf(id: NodeId): Rect;
	/** Renders one node to an image and returns an object URL for it. */
	imageUrl(id: NodeId, useAbsoluteBounds: boolean): Promise<string>;
}

const PERCENT = 255;

function cssColor(paint: Paint): string | null {
	if (paint.type !== 'SOLID' || !paint.visible) return null;
	const { r, g, b } = paint.color;
	const alpha = paint.opacity;
	return `rgba(${Math.round(r * PERCENT)}, ${Math.round(g * PERCENT)}, ${Math.round(b * PERCENT)}, ${alpha})`;
}

function backgroundOf(reader: DocumentReader, frameId: NodeId): string | null {
	const frame = reader.requireNode(frameId);
	if (!('fills' in frame)) return null;
	for (const paint of frame.fills) {
		const color = cssColor(paint);
		if (color !== null) return color;
	}
	return null;
}

function relativeTo(origin: Rect, bounds: Rect): Rect {
	return {
		x: bounds.x - origin.x,
		y: bounds.y - origin.y,
		width: bounds.width,
		height: bounds.height
	};
}

async function childLayers(
	environment: FrameRenderEnvironment,
	frameId: NodeId,
	origin: Rect
): Promise<RenderedLayer[]> {
	const { reader } = environment;
	const fixedIds = fixedChildIds(reader, frameId);
	const layers: RenderedLayer[] = [];
	for (const child of reader.childNodes(frameId)) {
		if ('visible' in child && !child.visible) continue;
		const bounds = relativeTo(origin, environment.renderBoundsOf(child.id));
		const url = await environment.imageUrl(child.id, false);
		layers.push({ url, ...bounds, fixed: fixedIds.has(child.id) });
	}
	return layers;
}

export async function renderFrame(
	environment: FrameRenderEnvironment,
	frameId: NodeId
): Promise<RenderedFrame> {
	const { reader } = environment;
	const frame = reader.requireNode(frameId);
	const origin = environment.boundsOf(frameId);
	let overflow = 'NONE';
	if (frame.type === 'FRAME') overflow = frame.overflowDirection;
	const scrollX =
		overflow === 'HORIZONTAL_SCROLLING' || overflow === 'HORIZONTAL_AND_VERTICAL_SCROLLING';
	const scrollY =
		overflow === 'VERTICAL_SCROLLING' || overflow === 'HORIZONTAL_AND_VERTICAL_SCROLLING';

	let layers: RenderedLayer[];
	if (scrollX || scrollY) {
		layers = await childLayers(environment, frameId, origin);
	} else {
		const url = await environment.imageUrl(frameId, true);
		layers = [{ url, x: 0, y: 0, width: origin.width, height: origin.height, fixed: false }];
	}

	let contentWidth = origin.width;
	let contentHeight = origin.height;
	for (const layer of layers) {
		if (layer.fixed) continue;
		contentWidth = Math.max(contentWidth, layer.x + layer.width);
		contentHeight = Math.max(contentHeight, layer.y + layer.height);
	}

	return {
		frameId,
		width: origin.width,
		height: origin.height,
		background: backgroundOf(reader, frameId),
		scrollX,
		scrollY,
		contentWidth,
		contentHeight,
		layers,
		hotspots: hotspotsOf(reader, frameId, (id) => environment.boundsOf(id))
	};
}
