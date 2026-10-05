// Planning for the small per-node commands: flip, visibility, lock, opacity, swap fill and
// stroke, delete, rename and find. Pure: each function reads the document and returns changes
// (or ids to select); applying them is the plugin's job.

import {
	composeMatrices,
	invertMatrix,
	planRemove,
	planSetProps,
	plainText,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type NodeId
} from '../document';
import { defaultStroke } from './paints';
import { isAutoLayoutChild, isPositioned, topLevelIds, unionBounds } from './selectionOps';

export type FlipAxis = 'horizontal' | 'vertical';

function mirrorAbout(
	axis: FlipAxis,
	bounds: { x: number; y: number; width: number; height: number }
): Matrix2x3 {
	if (axis === 'horizontal') {
		return [
			[-1, 0, 2 * bounds.x + bounds.width],
			[0, 1, 0]
		];
	}
	return [
		[1, 0, 0],
		[0, -1, 2 * bounds.y + bounds.height]
	];
}

/** Mirror the selection about the centre of its bounds, in screen axes. */
export function planFlip(reader: DocumentReader, ids: readonly NodeId[], axis: FlipAxis): Change[] {
	const flippable = topLevelIds(reader, ids)
		.map((id) => reader.requireNode(id))
		.filter(isPositioned)
		.filter((node) => !node.locked)
		.filter((node) => !isAutoLayoutChild(reader, node));
	if (flippable.length === 0) return [];
	const bounds = unionBounds(flippable.map((node) => reader.cache.absoluteBounds(node.id)));
	const mirror = mirrorAbout(axis, bounds);
	const changes: Change[] = [];
	for (const node of flippable) {
		const absolute = composeMatrices(mirror, reader.cache.absoluteTransform(node.id));
		const parentInverse =
			node.parentId === null ? null : invertMatrix(reader.cache.absoluteTransform(node.parentId));
		const transform = parentInverse === null ? absolute : composeMatrices(parentInverse, absolute);
		changes.push(...planSetProps(reader, node.id, { transform }));
	}
	return changes;
}

type Flag = 'visible' | 'locked';

/**
 * Toggle a boolean flag over the selection: when every selected node already has it `true` the
 * result is `false`, otherwise everything becomes `true` (so a mixed selection converges).
 */
function planFlagToggle(reader: DocumentReader, ids: readonly NodeId[], flag: Flag): Change[] {
	const nodes = topLevelIds(reader, ids)
		.map((id) => reader.requireNode(id))
		.filter(isPositioned);
	if (nodes.length === 0) return [];
	const allSet = nodes.every((node) => node[flag]);
	const changes: Change[] = [];
	for (const node of nodes) changes.push(...planSetProps(reader, node.id, { [flag]: !allSet }));
	return changes;
}

/** Hide when everything is visible, show otherwise. */
export function planToggleVisibility(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	return planFlagToggle(reader, ids, 'visible');
}

/** Lock when something is unlocked, unlock when everything is locked. */
export function planToggleLock(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	return planFlagToggle(reader, ids, 'locked');
}

/** Set the layer opacity (0 to 1) of every selected node that has one. */
export function planSetOpacity(
	reader: DocumentReader,
	ids: readonly NodeId[],
	opacity: number
): Change[] {
	if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
		throw new RangeError(`opacity must be between 0 and 1, got ${opacity}`);
	}
	const changes: Change[] = [];
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (!('opacity' in node)) continue;
		changes.push(...planSetProps(reader, id, { opacity }));
	}
	return changes;
}

/** Exchange the fill paints with the paints of the first stroke (a stroke is created if missing). */
export function planSwapFillAndStroke(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const changes: Change[] = [];
	for (const id of topLevelIds(reader, ids)) {
		const node = reader.requireNode(id);
		if (!('fills' in node) || !('strokes' in node)) continue;
		const [firstStroke, ...otherStrokes] = node.strokes;
		if (!firstStroke) {
			const created = [defaultStroke(node.fills)];
			changes.push(...planSetProps(reader, id, { fills: [], strokes: created }));
			continue;
		}
		const strokes = [{ ...firstStroke, paints: node.fills }, ...otherStrokes];
		changes.push(...planSetProps(reader, id, { fills: firstStroke.paints, strokes }));
	}
	return changes;
}

/** Delete the selected nodes with their subtrees. */
export function planDelete(reader: DocumentReader, ids: readonly NodeId[]): Change[] {
	const changes: Change[] = [];
	for (const id of topLevelIds(reader, ids)) changes.push(...planRemove(reader, id));
	return changes;
}

export function planRename(reader: DocumentReader, id: NodeId, name: string): Change[] {
	const trimmed = name.trim();
	if (trimmed.length === 0) throw new Error('a layer name cannot be empty');
	return planSetProps(reader, id, { name: trimmed });
}

export interface FindOptions {
	caseSensitive?: boolean;
}

/** Nodes on the page whose name or text content contains `query`, in document order. */
export function findNodes(
	reader: DocumentReader,
	pageId: NodeId,
	query: string,
	options: FindOptions = {}
): NodeId[] {
	if (query.length === 0) return [];
	const needle = options.caseSensitive ? query : query.toLowerCase();
	const matches = (haystack: string): boolean => {
		const text = options.caseSensitive ? haystack : haystack.toLowerCase();
		return text.includes(needle);
	};
	const found: NodeId[] = [];
	for (const node of reader.descendants(pageId)) {
		if (matches(node.name)) found.push(node.id);
		else if (node.type === 'TEXT' && matches(plainText(node.paragraphs))) found.push(node.id);
	}
	return found;
}
