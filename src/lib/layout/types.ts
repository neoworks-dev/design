// Input of the pure auto layout engine. The engine never sees the document: `buildLayoutTree`
// (build.ts) turns nodes into these plain values, `computeLayout` (engine.ts) returns sizes and
// positions. Results are derived data (data-model.md section 1): the autolayout plugin writes
// them back as ordinary changes in the triggering transaction (section 5).

import type { NodeId } from '../document/types';

export type Sizing = 'FIXED' | 'HUG' | 'FILL';
export type Positioning = 'AUTO' | 'ABSOLUTE';
export type Axis = 'x' | 'y';

export interface Size {
	width: number;
	height: number;
}

/** Space a stroke takes outside the node's box; counted in the layout when strokes are included. */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface LayoutItemBase {
	id: NodeId;
	/** Position relative to the parent now; echoed for absolutely positioned items. */
	x: number;
	y: number;
	width: number;
	height: number;
	minWidth: number | null;
	maxWidth: number | null;
	minHeight: number | null;
	maxHeight: number | null;
	sizingHorizontal: Sizing;
	sizingVertical: Sizing;
	positioning: Positioning;
	/** Stroke space added around the item when its parent includes strokes in the layout. */
	strokeInsets: Insets;
}

export interface LayoutLeaf extends LayoutItemBase {
	kind: 'leaf';
	/**
	 * Present on auto-sizing text. `width: null` asks for the natural single-line width; a number
	 * asks for the height at that width. Injected so the engine stays free of Skia.
	 */
	measureText?: (width: number | null) => Size;
}

export interface ContainerSettings {
	mode: 'HORIZONTAL' | 'VERTICAL';
	wrap: boolean;
	primaryAlign: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
	counterAlign: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
	counterContentAlign: 'AUTO' | 'SPACE_BETWEEN';
	itemSpacing: number;
	/** Gap between wrapped lines; `null` uses `itemSpacing`. */
	counterSpacing: number | null;
	padding: Insets;
}

export interface LayoutContainer extends LayoutItemBase {
	kind: 'container';
	settings: ContainerSettings;
	children: LayoutItem[];
}

export type LayoutItem = LayoutLeaf | LayoutContainer;
