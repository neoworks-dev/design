// Turns document nodes into the engine's input. Pure: it reads through a `LayoutNodeSource`, so
// callers decide whether the nodes come resolved (variables applied) and how text is measured.

import type { Node, NodeId, Stroke, TextNode } from '../document/types';
import type {
	ContainerSettings,
	Insets,
	LayoutContainer,
	LayoutItem,
	LayoutItemBase,
	LayoutLeaf,
	Size,
	Sizing
} from './types';
import { NO_INSETS } from './types';

export interface LayoutNodeSource {
	node(id: NodeId): Node;
	children(id: NodeId): readonly NodeId[];
	/** Natural single-line size for `width: null`, else the size at that width. */
	measureText(node: TextNode, width: number | null): Size;
}

type AutoLayoutNode = Extract<Node, { layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' }>;

/** A frame-like node that stacks its children (horizontal or vertical flow). */
export function isStackContainer(node: Node): node is AutoLayoutNode {
	if (!('layoutMode' in node)) return false;
	return node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
}

export function buildLayoutTree(source: LayoutNodeSource, rootId: NodeId): LayoutContainer {
	const root = source.node(rootId);
	if (!isStackContainer(root)) throw new Error(`not an auto layout container: ${rootId}`);
	return buildContainer(source, root, NO_INSETS);
}

function buildContainer(
	source: LayoutNodeSource,
	node: AutoLayoutNode,
	strokeInsets: Insets
): LayoutContainer {
	const settings = containerSettings(node);
	const children: LayoutItem[] = [];
	for (const childId of source.children(node.id)) {
		const child = source.node(childId);
		if (!isLaidOut(child)) continue;
		let insets = NO_INSETS;
		if (node.strokesIncludedInLayout) insets = strokeInsetsOf(child);
		children.push(buildItem(source, child, insets));
	}
	return {
		...baseOf(node, strokeInsets, node.layoutSizingHorizontal, node.layoutSizingVertical),
		kind: 'container',
		settings,
		children
	};
}

function buildItem(source: LayoutNodeSource, node: Node, strokeInsets: Insets): LayoutItem {
	if (isStackContainer(node)) return buildContainer(source, node, strokeInsets);
	if (node.type === 'TEXT') return buildText(source, node, strokeInsets);
	return {
		...baseOf(node, strokeInsets, sizingHorizontalOf(node), sizingVerticalOf(node)),
		kind: 'leaf'
	};
}

function buildText(source: LayoutNodeSource, node: TextNode, strokeInsets: Insets): LayoutLeaf {
	const sizing = textSizing(node);
	const leaf: LayoutLeaf = {
		...baseOf(node, strokeInsets, sizing.horizontal, sizing.vertical),
		kind: 'leaf'
	};
	if (node.textAutoResize === 'NONE' && sizing.vertical !== 'HUG' && sizing.horizontal !== 'HUG') {
		return leaf;
	}
	leaf.measureText = (width) => source.measureText(node, width);
	return leaf;
}

/**
 * Auto-sizing text hugs its content on the axes it grows on; a fill width turns an auto-width
 * text into an auto-height one (the plugin writes that back as `textAutoResize`).
 */
export function textSizing(node: TextNode): { horizontal: Sizing; vertical: Sizing } {
	const horizontal = node.layoutSizingHorizontal;
	const vertical = node.layoutSizingVertical;
	if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
		if (horizontal === 'FILL') return { horizontal, vertical: 'HUG' };
		return { horizontal: 'HUG', vertical: 'HUG' };
	}
	if (node.textAutoResize === 'HEIGHT') {
		if (horizontal === 'HUG') return { horizontal: 'FIXED', vertical: 'HUG' };
		return { horizontal, vertical: 'HUG' };
	}
	return { horizontal, vertical };
}

function sizingHorizontalOf(node: Node): Sizing {
	if (!('layoutSizingHorizontal' in node)) return 'FIXED';
	return node.layoutSizingHorizontal;
}

function sizingVerticalOf(node: Node): Sizing {
	if (!('layoutSizingVertical' in node)) return 'FIXED';
	return node.layoutSizingVertical;
}

/** Hidden children and pages take no part in the layout. */
function isLaidOut(node: Node): boolean {
	if (node.type === 'PAGE') return false;
	return node.visible;
}

function baseOf(
	node: Node,
	strokeInsets: Insets,
	sizingHorizontal: Sizing,
	sizingVertical: Sizing
): LayoutItemBase {
	if (node.type === 'PAGE') throw new Error('a page has no layout');
	const base: LayoutItemBase = {
		id: node.id,
		x: node.transform[0][2],
		y: node.transform[1][2],
		width: node.width,
		height: node.height,
		minWidth: null,
		maxWidth: null,
		minHeight: null,
		maxHeight: null,
		sizingHorizontal: sizingHorizontal,
		sizingVertical: sizingVertical,
		positioning: 'AUTO',
		strokeInsets
	};
	if (!('layoutPositioning' in node)) return base;
	base.minWidth = node.minWidth;
	base.maxWidth = node.maxWidth;
	base.minHeight = node.minHeight;
	base.maxHeight = node.maxHeight;
	base.positioning = node.layoutPositioning;
	return base;
}

function containerSettings(node: AutoLayoutNode): ContainerSettings {
	return {
		mode: node.layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL',
		wrap: node.layoutWrap === 'WRAP',
		primaryAlign: node.primaryAxisAlignItems,
		counterAlign: node.counterAxisAlignItems,
		counterContentAlign: node.counterAxisAlignContent,
		itemSpacing: node.itemSpacing,
		counterSpacing: node.counterAxisSpacing,
		padding: {
			top: node.paddingTop,
			right: node.paddingRight,
			bottom: node.paddingBottom,
			left: node.paddingLeft
		}
	};
}

/** How far the first stroke reaches outside the node's box, per side. */
export function strokeInsetsOf(node: Node): Insets {
	if (!('strokes' in node)) return NO_INSETS;
	const stroke = node.strokes.find((candidate) => candidate.paints.some((paint) => paint.visible));
	if (stroke === undefined) return NO_INSETS;
	return {
		top: reach(stroke, 'top'),
		right: reach(stroke, 'right'),
		bottom: reach(stroke, 'bottom'),
		left: reach(stroke, 'left')
	};
}

function reach(stroke: Stroke, side: keyof Insets): number {
	const weight = typeof stroke.weight === 'number' ? stroke.weight : stroke.weight[side];
	if (stroke.align === 'OUTSIDE') return weight;
	if (stroke.align === 'CENTER') return weight / 2;
	return 0;
}
