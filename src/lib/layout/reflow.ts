// Reflow: which auto layout trees a set of changes disturbs, and the changes that put every
// node of such a tree where the engine says. Pure; the autolayout plugin calls it from the
// `document/append` step, so the results join the triggering transaction (data-model.md section 5).

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId
} from '../document';
import { buildLayoutTree, isStackContainer, textSizing, type LayoutNodeSource } from './build';
import { computeLayout } from './engine';

/** Properties whose change can move or resize something in an auto layout tree. */
const LAYOUT_PROPERTIES: ReadonlySet<string> = new Set([
	'width',
	'height',
	'transform',
	'minWidth',
	'maxWidth',
	'minHeight',
	'maxHeight',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'layoutPositioning',
	'visible',
	'strokes',
	'layoutMode',
	'layoutWrap',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'counterAxisAlignContent',
	'itemSpacing',
	'counterAxisSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'strokesIncludedInLayout',
	'paragraphs',
	'defaultStyle',
	'textAutoResize',
	'textTruncation',
	'maxLines',
	'leadingTrim'
]);

const TOLERANCE = 0.0001;

function touchedIds(changes: readonly Change[]): Set<NodeId> {
	const ids = new Set<NodeId>();
	for (const change of changes) {
		if (change.t === 'add') {
			ids.add(change.node.id);
			if (change.node.parentId !== null) ids.add(change.node.parentId);
		} else if (change.t === 'del') {
			if (change.node.parentId !== null) ids.add(change.node.parentId);
		} else if (change.t === 'move') {
			ids.add(change.id);
			if (change.parent !== null) ids.add(change.parent);
			if (change.prevParent !== null) ids.add(change.prevParent);
		} else if (change.t === 'set') {
			if (Object.keys(change.set).some((key) => LAYOUT_PROPERTIES.has(key))) ids.add(change.id);
		}
	}
	return ids;
}

function stackParentOf(reader: DocumentReader, node: Node): Node | undefined {
	if (node.parentId === null) return undefined;
	const parent = reader.getNode(node.parentId);
	if (parent === undefined || !isStackContainer(parent)) return undefined;
	return parent;
}

/** The outermost stack of a chain of nested stacks: where a reflow has to start. */
function outermostStack(reader: DocumentReader, start: Node): Node {
	let current = start;
	for (
		let parent = stackParentOf(reader, current);
		parent;
		parent = stackParentOf(reader, parent)
	) {
		current = parent;
	}
	return current;
}

/** Ids of the auto layout trees `changes` can have disturbed, outermost container of each. */
export function findLayoutRoots(reader: DocumentReader, changes: readonly Change[]): NodeId[] {
	const roots = new Set<NodeId>();
	for (const id of touchedIds(changes)) {
		const node = reader.getNode(id);
		if (node === undefined) continue;
		if (isStackContainer(node)) roots.add(outermostStack(reader, node).id);
		const parent = stackParentOf(reader, node);
		if (parent !== undefined) roots.add(outermostStack(reader, parent).id);
	}
	return [...roots];
}

function differs(left: number, right: number): boolean {
	return Math.abs(left - right) > TOLERANCE;
}

function movedTo(transform: Matrix2x3, x: number, y: number): Matrix2x3 | undefined {
	if (!differs(transform[0][2], x) && !differs(transform[1][2], y)) return undefined;
	return [
		[transform[0][0], transform[0][1], x],
		[transform[1][0], transform[1][1], y]
	];
}

/**
 * Changes that lay out the tree under `rootId`. `source` yields the (resolved) values the engine
 * reads; `reader` holds the stored nodes the changes are planned against. Idempotent: planning
 * again after applying yields nothing.
 */
export function planReflow(
	reader: DocumentReader,
	source: LayoutNodeSource,
	rootId: NodeId
): Change[] {
	const results = computeLayout(buildLayoutTree(source, rootId));
	const changes: Change[] = [];
	for (const [id, result] of results) {
		const stored = reader.requireNode(id);
		if (stored.type === 'PAGE') continue;
		const props: Record<string, unknown> = {};
		if (differs(stored.width, result.width)) props.width = result.width;
		if (differs(stored.height, result.height)) props.height = result.height;
		if (id !== rootId) {
			const transform = movedTo(stored.transform, result.x, result.y);
			if (transform !== undefined) props.transform = transform;
		}
		if (needsFixedWidthText(source.node(id))) props.textAutoResize = 'HEIGHT';
		Object.assign(props, axisSizingModes(source.node(id)));
		changes.push(...planSetProps(reader, id, props));
	}
	return changes;
}

/**
 * `layoutSizing*` is the source of truth for how a container sizes itself; the Figma-compatible
 * `primaryAxisSizingMode` / `counterAxisSizingMode` mirror it (AUTO is hug) for plugins and AI.
 */
function axisSizingModes(node: Node): Record<string, unknown> {
	if (!isStackContainer(node)) return {};
	const horizontalMode = node.layoutSizingHorizontal === 'HUG' ? 'AUTO' : 'FIXED';
	const verticalMode = node.layoutSizingVertical === 'HUG' ? 'AUTO' : 'FIXED';
	if (node.layoutMode === 'HORIZONTAL') {
		return { primaryAxisSizingMode: horizontalMode, counterAxisSizingMode: verticalMode };
	}
	return { primaryAxisSizingMode: verticalMode, counterAxisSizingMode: horizontalMode };
}

/** Fill width on auto-width text: the width is now the container's, so only the height follows. */
function needsFixedWidthText(node: Node): boolean {
	if (node.type !== 'TEXT' || node.textAutoResize !== 'WIDTH_AND_HEIGHT') return false;
	return textSizing(node).horizontal === 'FILL';
}
