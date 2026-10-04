// Derived data: computed from the persisted document, cached, never saved (data-model.md section 1).
// Nothing in types.ts may carry these names; derived.test.ts enforces it at the type level.

import type { Matrix2x3, NodeId, Rect, RGBA } from './types';

export interface AbsoluteGeometry {
	/** Transform from the node's local space to page space. */
	absoluteTransform: Matrix2x3;
	/** Axis-aligned bounds in page space. */
	absoluteBoundingBox: Rect;
}

export interface LayoutResult {
	nodeId: NodeId;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TextLayoutResult {
	nodeId: NodeId;
	lineCount: number;
	width: number;
	height: number;
}

/** Variable bindings resolved against the active modes. */
export type ResolvedVariableValues = Record<string, boolean | number | string | RGBA>;

export const DERIVED_FIELD_NAMES = [
	'absoluteTransform',
	'absoluteBoundingBox',
	'absoluteRenderBounds',
	'layoutResult',
	'textLayout',
	'fillGeometry',
	'strokeGeometry',
	'resolvedValues'
] as const;
export type DerivedFieldName = (typeof DERIVED_FIELD_NAMES)[number];
