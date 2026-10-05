// Compact JSON of nodes for the model: Figma-like names, resolved values (variables applied, D6),
// and a node budget so a big document never floods the context. A node that did not fit keeps its
// id, type, name and `childCount`; the model continues with `read_tree` on that id.

import {
	plainText,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Paint,
	type Stroke
} from '../../document';
import { rgbToHex } from './color';

export const DEFAULT_TREE_DEPTH = 3;
export const DEFAULT_NODE_BUDGET = 150;

/** What serialization needs from the document and the variable resolver. */
export interface TreeSource {
	get(id: NodeId): Node | undefined;
	children(id: NodeId | null): readonly NodeId[];
	/** The node with variable bindings applied. */
	resolved(id: NodeId): Node;
}

export type JsonObject = Record<string, unknown>;

function paintSummary(paint: Paint): unknown {
	if (paint.type === 'SOLID') {
		const summary: JsonObject = { type: 'SOLID', color: rgbToHex(paint.color) };
		if (paint.opacity !== 1) summary.opacity = paint.opacity;
		if (!paint.visible) summary.visible = false;
		return summary;
	}
	if (paint.type === 'IMAGE') return { type: 'IMAGE' };
	return { type: paint.type, stops: paint.gradientStops.length };
}

function strokeSummary(stroke: Stroke): unknown {
	return { paints: stroke.paints.map(paintSummary), weight: stroke.weight, align: stroke.align };
}

function translation(transform: Matrix2x3): { x: number; y: number } {
	return { x: transform[0][2], y: transform[1][2] };
}

function rotationDegrees(transform: Matrix2x3): number {
	const radians = Math.atan2(transform[1][0], transform[0][0]);
	return Math.round(((radians * 180) / Math.PI) * 100) / 100;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function addGeometry(summary: JsonObject, node: Node): void {
	if (node.type === 'PAGE') return;
	const { x, y } = translation(node.transform);
	summary.x = round(x);
	summary.y = round(y);
	summary.width = round(node.width);
	summary.height = round(node.height);
	const rotation = rotationDegrees(node.transform);
	if (rotation !== 0) summary.rotation = rotation;
}

function addAppearance(summary: JsonObject, node: Node): void {
	if (node.type === 'PAGE') return;
	if (!node.visible) summary.visible = false;
	if (node.locked) summary.locked = true;
	if ('opacity' in node && node.opacity !== 1) summary.opacity = node.opacity;
	if ('fills' in node && node.fills.length > 0) summary.fills = node.fills.map(paintSummary);
	if ('strokes' in node && node.strokes.length > 0)
		summary.strokes = node.strokes.map(strokeSummary);
	if ('cornerRadius' in node && node.cornerRadius !== 0) summary.cornerRadius = node.cornerRadius;
}

function addLayout(summary: JsonObject, node: Node): void {
	if (!('layoutMode' in node) || node.layoutMode === 'NONE') return;
	summary.layout = {
		mode: node.layoutMode,
		gap: node.itemSpacing,
		padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]
	};
}

function addSpecifics(summary: JsonObject, node: Node): void {
	if (node.type === 'TEXT') {
		summary.characters = plainText(node.paragraphs);
		summary.fontSize = node.defaultStyle.fontSize;
		return;
	}
	if (node.componentRef !== undefined) summary.componentRef = node.componentRef;
	if (node.type === 'COMPONENT') summary.key = node.key;
}

function addBindings(summary: JsonObject, raw: Node): void {
	const bound = raw.boundVariables;
	if (bound === undefined) return;
	const names = Object.keys(bound);
	if (names.length > 0) summary.boundVariables = names;
}

/** One node without its children (the model reads `childCount`). */
export function serializeNode(source: TreeSource, id: NodeId): JsonObject {
	const node = source.resolved(id);
	const summary: JsonObject = { id: node.id, type: node.type, name: node.name };
	addGeometry(summary, node);
	addAppearance(summary, node);
	addLayout(summary, node);
	addSpecifics(summary, node);
	const raw = source.get(id);
	if (raw) addBindings(summary, raw);
	summary.childCount = source.children(id).length;
	return summary;
}

interface Budget {
	remaining: number;
}

function serializeBelow(source: TreeSource, id: NodeId, depth: number, budget: Budget): JsonObject {
	const summary = serializeNode(source, id);
	const childIds = source.children(id);
	if (childIds.length === 0 || depth <= 0) return summary;
	const children: JsonObject[] = [];
	for (const childId of childIds) {
		if (budget.remaining <= 0) {
			summary.truncated = `${childIds.length - children.length} more children; read_tree nodeId=${id}`;
			break;
		}
		budget.remaining -= 1;
		children.push(serializeBelow(source, childId, depth - 1, budget));
	}
	summary.children = children;
	return summary;
}

export interface TreeOptions {
	depth?: number;
	/** Most nodes in the answer. */
	budget?: number;
}

/** `id` and everything below it down to `depth` levels, in at most `budget` nodes. */
export function serializeTree(
	source: TreeSource,
	id: NodeId,
	options: TreeOptions = {}
): JsonObject {
	const depth = options.depth === undefined ? DEFAULT_TREE_DEPTH : options.depth;
	const budget = options.budget === undefined ? DEFAULT_NODE_BUDGET : options.budget;
	return serializeBelow(source, id, depth, { remaining: budget - 1 });
}

/** Pick `fields` out of a resolved node; unknown fields are reported, not dropped silently. */
export function pickFields(node: Node, fields: string[]): JsonObject {
	const picked: JsonObject = { id: node.id, type: node.type };
	const missing: string[] = [];
	for (const field of fields) {
		if (Object.hasOwn(node, field)) picked[field] = Reflect.get(node, field);
		else missing.push(field);
	}
	if (missing.length > 0) picked.unknownFields = missing;
	return picked;
}
