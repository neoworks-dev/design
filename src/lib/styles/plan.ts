// Change planning for shared styles (#113). Pure: no kernel, no Svelte.
//
// Model. A style is a document entity `{ id, type, name, description, value }`; a node refers to it
// by `fillStyleId`, `strokeStyleId`, `effectStyleId`, `gridStyleId` or `defaultStyle.textStyleId`.
// Readers see the style's current value through the resolver (`styledNode`). The node also keeps a
// raw copy of the value, like a bound variable keeps its fallback: applying writes it, and editing
// the style rewrites it in the same transaction (`planSyncConsumers`), so the stored node is
// always what the resolved node shows and detaching only has to drop the id.

import {
	planSetProps,
	STYLE_TARGET_LIST,
	STYLE_TARGETS,
	styleIdOf,
	styleProps,
	TEXT_STYLE_KEYS,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type Paint,
	type Style,
	type StyleTarget,
	type StyleType
} from '../document';
import { defaultStroke } from '../editing/paints';

/** The value a style created from `node` for `target` would hold, or `undefined` if none fits. */
export function currentStyleValue(node: Node, target: StyleTarget): unknown {
	if (target === 'fill') {
		if (!('fills' in node)) return undefined;
		return node.fills;
	}
	if (target === 'stroke') {
		if (!('strokes' in node) || node.strokes.length === 0) return undefined;
		return node.strokes[0].paints;
	}
	if (target === 'effect') {
		if (!('effects' in node)) return undefined;
		return node.effects;
	}
	if (target === 'grid') {
		if (!('layoutGrids' in node)) return undefined;
		return node.layoutGrids;
	}
	if (node.type !== 'TEXT') return undefined;
	const value: Record<string, unknown> = {};
	for (const key of TEXT_STYLE_KEYS) value[key] = node.defaultStyle[key];
	return value;
}

/** Whether `target` makes sense for `node` at all (the style button hides otherwise). */
export function acceptsStyle(node: Node, target: StyleTarget): boolean {
	if (target === 'text') return node.type === 'TEXT';
	if (target === 'fill') return 'fills' in node;
	if (target === 'stroke') return 'strokes' in node;
	if (target === 'effect') return 'effects' in node;
	return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
}

/** Changes that apply `style` to `nodeId` for `target`: the id plus the raw copy. */
export function planApplyStyle(
	reader: DocumentReader,
	nodeId: NodeId,
	target: StyleTarget,
	style: Style
): Change[] {
	const node = reader.requireNode(nodeId);
	if (target === 'stroke' && 'strokes' in node && node.strokes.length === 0) {
		let paints: Paint[] = [];
		if (Array.isArray(style.value)) paints = style.value;
		return planSetProps(reader, nodeId, {
			strokes: [defaultStroke(paints)],
			[STYLE_TARGETS[target].idKey]: style.id
		});
	}
	const props = styleProps(node, target, style, true);
	if (Object.keys(props).length === 0) return [];
	if (target !== 'text') props[STYLE_TARGETS[target].idKey] = style.id;
	return planSetProps(reader, nodeId, props);
}

/** Changes that drop the style id of `target` from `nodeId`; the raw values stay. */
export function planDetachStyle(
	reader: DocumentReader,
	nodeId: NodeId,
	target: StyleTarget
): Change[] {
	const node = reader.requireNode(nodeId);
	if (styleIdOf(node, target) === undefined) return [];
	if (target === 'text' && node.type === 'TEXT') {
		const defaultStyle = { ...node.defaultStyle };
		delete defaultStyle.textStyleId;
		return planSetProps(reader, nodeId, { defaultStyle });
	}
	return planSetProps(reader, nodeId, { [STYLE_TARGETS[target].idKey]: undefined });
}

export interface StyleConsumer {
	nodeId: NodeId;
	target: StyleTarget;
}

/** Every node that refers to `styleId`, and through which target. */
export function consumersOf(reader: DocumentReader, styleId: string): StyleConsumer[] {
	const consumers: StyleConsumer[] = [];
	for (const node of Object.values(reader.document.nodes)) {
		for (const target of STYLE_TARGET_LIST) {
			if (styleIdOf(node, target) === styleId) consumers.push({ nodeId: node.id, target });
		}
	}
	return consumers;
}

/** Rewrite the raw copies of every consumer of `style` (after the style's value changed). */
export function planSyncConsumers(reader: DocumentReader, style: Style): Change[] {
	const changes: Change[] = [];
	for (const consumer of consumersOf(reader, style.id)) {
		changes.push(...planApplyStyle(reader, consumer.nodeId, consumer.target, style));
	}
	return changes;
}

/** Drop `styleId` from every consumer (the style is being deleted): they keep their values. */
export function planDetachAll(reader: DocumentReader, styleId: string): Change[] {
	const changes: Change[] = [];
	for (const consumer of consumersOf(reader, styleId)) {
		changes.push(...planDetachStyle(reader, consumer.nodeId, consumer.target));
	}
	return changes;
}

const CONTENT_KEY: Record<Exclude<StyleTarget, 'text'>, string> = {
	fill: 'fills',
	stroke: 'strokes',
	effect: 'effects',
	grid: 'layoutGrids'
};

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function strokePaints(strokes: unknown): unknown {
	if (!Array.isArray(strokes)) return strokes;
	return strokes.map((stroke: { paints: unknown }) => stroke.paints);
}

function editsStyledValue(node: Node, target: StyleTarget, set: Record<string, unknown>): boolean {
	if (target === 'text') {
		if (node.type !== 'TEXT' || !('defaultStyle' in set)) return false;
		const next = set.defaultStyle;
		if (typeof next !== 'object' || next === null) return false;
		if (Reflect.get(next, 'textStyleId') !== node.defaultStyle.textStyleId) return false;
		return TEXT_STYLE_KEYS.some((key) => !sameJson(Reflect.get(next, key), node.defaultStyle[key]));
	}
	const key = CONTENT_KEY[target];
	if (!(key in set)) return false;
	if (STYLE_TARGETS[target].idKey in set) return false;
	if (target === 'stroke') {
		return !sameJson(strokePaints(set[key]), strokePaints(Reflect.get(node, key)));
	}
	return true;
}

/**
 * `document/before-apply` rewrite: editing a value a style provides detaches the node from it
 * (Figma behaviour) by adding the cleared id to the same `set`. The style's own writes carry the
 * id, so they are left alone.
 */
export function detachOnEdit(reader: DocumentReader, changes: Change[]): Change[] {
	return changes.map((change) => {
		if (change.t !== 'set' || !reader.hasNode(change.id)) return change;
		const node = reader.requireNode(change.id);
		let result = change;
		for (const target of STYLE_TARGET_LIST) {
			const styleId = styleIdOf(node, target);
			if (styleId === undefined || !editsStyledValue(node, target, result.set)) continue;
			result = detachedSet(node, target, result);
		}
		return result;
	});
}

function detachedSet(
	node: Node,
	target: StyleTarget,
	change: Extract<Change, { t: 'set' }>
): Extract<Change, { t: 'set' }> {
	if (target === 'text' && node.type === 'TEXT') {
		const defaultStyle = { ...(change.set.defaultStyle as object) };
		Reflect.deleteProperty(defaultStyle, 'textStyleId');
		return { ...change, set: { ...change.set, defaultStyle } };
	}
	const idKey = STYLE_TARGETS[target].idKey;
	return {
		...change,
		set: { ...change.set, [idKey]: undefined },
		prev: { ...change.prev, [idKey]: Reflect.get(node, idKey) }
	};
}

/** The style type of a target, for pickers. */
export function styleTypeOf(target: StyleTarget): StyleType {
	return STYLE_TARGETS[target].type;
}
