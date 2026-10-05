// The purple labels over main components and component sets (Figma: a diamond and the name above
// the top-left corner), drawn on the overlay in screen space. Top-level mains and sets already have
// their name from the frame tool's labels; the "N variants" chip of a set is the `variants` plugin's.

import type { Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import type { OverlayFrame } from '../overlay/types';

export const COMPONENT_PURPLE = '#9747ff';
const LABEL_FONT = '11px Inter, system-ui, sans-serif';
const LABEL_GAP = 6;
const MIN_ZOOM_FOR_VARIANT_LABELS = 0.4;

export interface ComponentLabel {
	id: NodeId;
	text: string;
	kind: 'component' | 'set' | 'variant';
	/** Top-level mains and sets already have their name above them (the frame tool's labels). */
	named: boolean;
}

/** Labels for the mains and sets on the current page, recomputed only when the document changes. */
export class LabelIndex {
	private revision = -1;
	private pageId = '';
	private labels: ComponentLabel[] = [];

	labelsOnPage(ctx: Context): ComponentLabel[] {
		const revision = ctx.document.revision;
		const pageId = ctx.document.currentPageId;
		if (revision === this.revision && pageId === this.pageId) return this.labels;
		this.labels = collectLabels(ctx, pageId);
		this.revision = revision;
		this.pageId = pageId;
		return this.labels;
	}
}

function collectLabels(ctx: Context, pageId: NodeId): ComponentLabel[] {
	const labels: ComponentLabel[] = [];
	for (const node of ctx.document.descendants(pageId)) {
		const label = labelOf(ctx, node);
		if (label !== undefined) labels.push(label);
	}
	return labels;
}

function labelOf(ctx: Context, node: Node): ComponentLabel | undefined {
	if (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT') return undefined;
	const parent = node.parentId === null ? undefined : ctx.document.get(node.parentId);
	const named = parent !== undefined && parent.type === 'PAGE';
	if (node.type === 'COMPONENT_SET') return { id: node.id, text: node.name, kind: 'set', named };
	if (ctx.componentSync.variantSetOf(node.id) !== undefined) {
		return { id: node.id, text: node.name, kind: 'variant', named };
	}
	return { id: node.id, text: node.name, kind: 'component', named };
}

function drawDiamond(frame: OverlayFrame, centerX: number, centerY: number, size: number): void {
	const canvas = frame.ctx;
	canvas.beginPath();
	canvas.moveTo(centerX, centerY - size);
	canvas.lineTo(centerX + size, centerY);
	canvas.lineTo(centerX, centerY + size);
	canvas.lineTo(centerX - size, centerY);
	canvas.closePath();
	canvas.fill();
}

function drawLabel(ctx: Context, frame: OverlayFrame, label: ComponentLabel): void {
	if (label.named) return;
	const bounds = frame.worldRectToScreen(ctx.document.absoluteBounds(label.id));
	const canvas = frame.ctx;
	canvas.font = LABEL_FONT;
	canvas.textBaseline = 'alphabetic';
	canvas.fillStyle = COMPONENT_PURPLE;
	const baseline = bounds.y - LABEL_GAP;
	drawDiamond(frame, bounds.x + 5, baseline - 4, 4.5);
	canvas.fillText(label.text, bounds.x + 14, baseline);
}

/** Draw the labels; variants only once zoomed in far enough to read them. */
export function drawComponentLabels(ctx: Context, frame: OverlayFrame, index: LabelIndex): void {
	for (const label of index.labelsOnPage(ctx)) {
		if (label.kind === 'variant' && frame.camera.scale < MIN_ZOOM_FOR_VARIANT_LABELS) continue;
		drawLabel(ctx, frame, label);
	}
}

/** Reads every reactive input of `drawComponentLabels`, so a change redraws the overlay. */
export function trackComponentLabels(ctx: Context): void {
	void ctx.document.revision;
	void ctx.document.currentPageId;
}
