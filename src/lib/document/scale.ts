// Proportional scaling of nodes (the Scale tool, K; also plugin API `rescale`). Unlike a resize,
// a scale multiplies every length-like property by one factor: text size, stroke weight, effect
// radii, corner radii, auto layout spacing and padding. Descendants scale in place, irrespective
// of their constraints and of auto layout. Pure.

import { planSetProps } from './changes';
import type { DocumentReader } from './store';
import type {
	BlurEffect,
	Change,
	Effect,
	Matrix2x3,
	Node,
	NodeId,
	Paragraph,
	ShadowEffect,
	Stroke,
	StrokeWeights,
	TextMeasure,
	TextStyle,
	VectorNetwork
} from './types';

export interface ScaledGeometry {
	transform: Matrix2x3;
	width: number;
	height: number;
}

function scaleNumber(value: number, factor: number): number {
	return value * factor;
}

function scaleWeight(weight: number | StrokeWeights, factor: number): number | StrokeWeights {
	if (typeof weight === 'number') return scaleNumber(weight, factor);
	return {
		top: weight.top * factor,
		right: weight.right * factor,
		bottom: weight.bottom * factor,
		left: weight.left * factor
	};
}

function scaleStroke(stroke: Stroke, factor: number): Stroke {
	return {
		...stroke,
		weight: scaleWeight(stroke.weight, factor),
		dashPattern: stroke.dashPattern.map((length) => length * factor)
	};
}

function isShadow(effect: Effect): effect is ShadowEffect {
	return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW';
}

function scaleEffect(effect: Effect, factor: number): Effect {
	if (isShadow(effect)) {
		return {
			...effect,
			offset: { x: effect.offset.x * factor, y: effect.offset.y * factor },
			radius: effect.radius * factor,
			spread: effect.spread * factor
		};
	}
	const blur: BlurEffect = effect;
	const scaled: BlurEffect = { ...blur, radius: blur.radius * factor };
	if (blur.startRadius !== undefined) scaled.startRadius = blur.startRadius * factor;
	return scaled;
}

function scaleMeasure<T extends TextMeasure | { unit: 'AUTO' }>(measure: T, factor: number): T {
	if (measure.unit !== 'PIXELS' || !('value' in measure)) return measure;
	return { ...measure, value: measure.value * factor };
}

function scaleTextStyle(style: Partial<TextStyle>, factor: number): Partial<TextStyle> {
	const scaled: Partial<TextStyle> = { ...style };
	if (style.fontSize !== undefined) scaled.fontSize = style.fontSize * factor;
	if (style.letterSpacing !== undefined) {
		scaled.letterSpacing = scaleMeasure(style.letterSpacing, factor);
	}
	if (style.lineHeight !== undefined) scaled.lineHeight = scaleMeasure(style.lineHeight, factor);
	return scaled;
}

function scaleParagraph(paragraph: Paragraph, factor: number): Paragraph {
	return {
		...paragraph,
		indent: paragraph.indent * factor,
		spacingAfter: paragraph.spacingAfter * factor,
		runs: paragraph.runs.map((run) => ({ ...run, style: scaleTextStyle(run.style, factor) }))
	};
}

/** Vector networks are stored in node units, so their points scale with the node. */
function scaleNetwork(network: VectorNetwork, factor: number): VectorNetwork {
	return {
		...network,
		vertices: network.vertices.map((vertex) => {
			const scaled = { ...vertex, x: vertex.x * factor, y: vertex.y * factor };
			if (vertex.cornerRadius !== undefined) scaled.cornerRadius = vertex.cornerRadius * factor;
			return scaled;
		}),
		segments: network.segments.map((segment) => {
			const scaled = { ...segment };
			if (segment.tangentStart !== undefined) {
				scaled.tangentStart = {
					x: segment.tangentStart.x * factor,
					y: segment.tangentStart.y * factor
				};
			}
			if (segment.tangentEnd !== undefined) {
				scaled.tangentEnd = { x: segment.tangentEnd.x * factor, y: segment.tangentEnd.y * factor };
			}
			return scaled;
		})
	};
}

const LENGTH_KEYS = [
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'gridRowGap',
	'gridColumnGap'
] as const;

/**
 * The property changes that scale everything but position and size (those depend on the handle
 * being dragged, see `planScaleSubtree`) by `factor`.
 */
export function scaledProps(node: Node, factor: number): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	const record = node as unknown as Record<string, unknown>;
	if ('strokes' in node) props.strokes = node.strokes.map((stroke) => scaleStroke(stroke, factor));
	if ('effects' in node) props.effects = node.effects.map((effect) => scaleEffect(effect, factor));
	if ('cornerRadius' in node) {
		const radius = node.cornerRadius;
		if (typeof radius === 'number') props.cornerRadius = radius * factor;
		else props.cornerRadius = radius.map((corner) => corner * factor);
	}
	if (node.type === 'TEXT') {
		props.defaultStyle = scaleTextStyle(node.defaultStyle, factor);
		props.paragraphs = node.paragraphs.map((paragraph) => scaleParagraph(paragraph, factor));
	}
	if (node.type === 'VECTOR') props.network = scaleNetwork(node.network, factor);
	for (const key of LENGTH_KEYS) {
		const value = record[key];
		if (typeof value === 'number') props[key] = value * factor;
	}
	if (typeof record.counterAxisSpacing === 'number') {
		props.counterAxisSpacing = record.counterAxisSpacing * factor;
	}
	return props;
}

function isPositioned(node: Node): node is Exclude<Node, { type: 'PAGE' }> {
	return node.type !== 'PAGE';
}

/** Where the nodes to scale are read from: the live document or a snapshot taken earlier. */
export interface ScaleSource {
	node(id: NodeId): Node;
	children(id: NodeId): readonly NodeId[];
}

export type ScaleEdits = Map<NodeId, Record<string, unknown>>;

function scaleChild(source: ScaleSource, id: NodeId, factor: number, edits: ScaleEdits): void {
	const node = source.node(id);
	if (!isPositioned(node)) return;
	const [[a, c, e], [b, d, f]] = node.transform;
	edits.set(id, {
		...scaledProps(node, factor),
		transform: [
			[a, c, e * factor],
			[b, d, f * factor]
		],
		width: node.width * factor,
		height: node.height * factor
	});
	for (const childId of source.children(id)) scaleChild(source, childId, factor, edits);
}

/**
 * Give `id` the geometry `target` and scale its whole subtree by the same factor: descendants
 * keep their orientation and move and grow with the node, whatever their constraints say.
 */
export function scaleEdits(source: ScaleSource, id: NodeId, target: ScaledGeometry): ScaleEdits {
	const edits: ScaleEdits = new Map();
	const node = source.node(id);
	if (!isPositioned(node) || node.width === 0) return edits;
	const factor = target.width / node.width;
	edits.set(id, { ...scaledProps(node, factor), ...target });
	for (const childId of source.children(id)) scaleChild(source, childId, factor, edits);
	return edits;
}

export function editsToChanges(reader: DocumentReader, edits: ScaleEdits): Change[] {
	const changes: Change[] = [];
	for (const [id, props] of edits) changes.push(...planSetProps(reader, id, props));
	return changes;
}

export function planScaleSubtree(
	reader: DocumentReader,
	id: NodeId,
	target: ScaledGeometry
): Change[] {
	const source: ScaleSource = {
		node: (nodeId) => reader.requireNode(nodeId),
		children: (nodeId) => reader.children(nodeId)
	};
	return editsToChanges(reader, scaleEdits(source, id, target));
}

/**
 * Plugin API `rescale(factor)`: scale a node and its subtree about the node's own top left,
 * which stays where it is.
 */
export function planRescale(reader: DocumentReader, id: NodeId, factor: number): Change[] {
	const node = reader.requireNode(id);
	if (!isPositioned(node) || !(factor > 0)) return [];
	return planScaleSubtree(reader, id, {
		transform: node.transform,
		width: node.width * factor,
		height: node.height * factor
	});
}
