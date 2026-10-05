// Which node properties belong to which `touched` group (data-model.md section 7, "Touched
// groups"). An instance node that overrides a property marks the group touched; the sync engine
// then stops copying that group from the main component. Pure: no kernel, no Svelte.

import { plainText } from './text';
import { TOUCHED_GROUPS, type Node, type Paragraph, type TouchedGroup } from './types';

const AUTO_LAYOUT_KEYS = [
	'layoutMode',
	'layoutWrap',
	'primaryAxisSizingMode',
	'counterAxisSizingMode',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'counterAxisAlignContent',
	'itemSpacing',
	'counterAxisSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'itemReverseZIndex',
	'strokesIncludedInLayout',
	'clipsContent',
	'gridRows',
	'gridColumns',
	'gridRowGap',
	'gridColumnGap',
	'layoutGrids',
	'guides',
	'overflowDirection',
	'numberOfFixedChildren'
];

/** The properties each group stands for, when copying a group from one node to another. */
export const GROUP_KEYS: Record<TouchedGroup, readonly string[]> = {
	name: ['name'],
	visibility: ['visible', 'locked'],
	geometry: [
		'transform',
		'width',
		'height',
		'constraints',
		'minWidth',
		'maxWidth',
		'minHeight',
		'maxHeight',
		'constrainProportions',
		'layoutSizingHorizontal',
		'layoutSizingVertical',
		'layoutPositioning'
	],
	corners: ['cornerRadius', 'cornerSmoothing'],
	fills: ['fills', 'fillStyleId'],
	strokes: ['strokes', 'strokeStyleId'],
	effects: ['effects', 'effectStyleId'],
	blend: ['opacity', 'blendMode', 'isMask', 'maskType'],
	'auto-layout': AUTO_LAYOUT_KEYS,
	'text-content': ['paragraphs'],
	'text-style': [
		'paragraphs',
		'defaultStyle',
		'textAutoResize',
		'textTruncation',
		'maxLines',
		'textAlignVertical',
		'leadingTrim'
	],
	vector: ['network', 'arcData', 'pointCount', 'innerRadius', 'booleanOperation'],
	prototype: ['reactions'],
	'component-properties': ['componentProperties'],
	'plugin-data': ['pluginData']
};

/** Properties of an instance root that belong to the instance itself, never to its main. */
export const INSTANCE_ROOT_OWN_KEYS: readonly string[] = [
	'transform',
	'layoutPositioning',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'constraints',
	'visible',
	'locked',
	'componentProperties'
];

const PROPERTY_GROUP = new Map<string, TouchedGroup>();
for (const group of TOUCHED_GROUPS) {
	for (const key of GROUP_KEYS[group]) {
		if (!PROPERTY_GROUP.has(key)) PROPERTY_GROUP.set(key, group);
	}
}

/** The group a property belongs to; `undefined` for properties no override can be tracked on. */
export function groupOfProperty(key: string): TouchedGroup | undefined {
	return PROPERTY_GROUP.get(key);
}

/** An instance root has a main component; every other instance node has a `componentRef`. */
export function isInstanceRoot(node: Node): boolean {
	return node.type === 'INSTANCE' && node.componentRef === undefined;
}

/** The node this one is a materialized copy of: its `componentRef`, or the main for a root. */
export function counterpartIdOf(node: Node): string | undefined {
	if (node.componentRef !== undefined) return node.componentRef;
	if (node.type === 'INSTANCE') return node.mainComponentId;
	return undefined;
}

/** False for the keys an instance root owns itself: they are neither overrides nor synced. */
export function trackedOnNode(node: Node, key: string): boolean {
	if (isInstanceRoot(node) && INSTANCE_ROOT_OWN_KEYS.includes(key)) return false;
	return true;
}

function paragraphGroup(previous: unknown, next: unknown): TouchedGroup {
	const before = plainText(previous as Paragraph[]);
	const after = plainText(next as Paragraph[]);
	if (before === after) return 'text-style';
	return 'text-content';
}

function boundVariableKeys(previous: unknown, next: unknown): string[] {
	const keys = new Set<string>();
	for (const record of [previous, next]) {
		if (typeof record !== 'object' || record === null) continue;
		for (const key of Object.keys(record)) keys.add(key);
	}
	return [...keys];
}

/** Groups a `set` of `node` overrides. Keys without a group, and the node's own keys, add none. */
export function groupsOfSet(
	node: Node,
	set: Record<string, unknown>,
	prev: Record<string, unknown>
): TouchedGroup[] {
	const groups = new Set<TouchedGroup>();
	for (const key of Object.keys(set)) {
		if (!trackedOnNode(node, key)) continue;
		if (key === 'paragraphs') {
			groups.add(paragraphGroup(prev[key], set[key]));
			continue;
		}
		if (key === 'boundVariables') {
			for (const bound of boundVariableKeys(prev[key], set[key])) {
				const group = groupOfProperty(bound);
				if (group !== undefined) groups.add(group);
			}
			continue;
		}
		const group = groupOfProperty(key);
		if (group !== undefined) groups.add(group);
	}
	return [...groups];
}

/** Whether the node's touched groups block syncing `key` from its main. */
export function isKeyOverridden(node: Node, key: string): boolean {
	const touched = node.touched;
	if (touched === undefined || touched.length === 0) return false;
	if (key === 'paragraphs') {
		return touched.includes('text-content') || touched.includes('text-style');
	}
	const group = groupOfProperty(key);
	if (group === undefined) return false;
	return touched.includes(group);
}

/** The groups a node overrides; empty for nodes that are not copies. */
export function touchedOf(node: Node): readonly TouchedGroup[] {
	if (node.touched === undefined) return [];
	return node.touched;
}

/** A deep copy of a node as a plain record, for building a node of another type from it. */
export function cloneAsRecord(node: Node): Record<string, unknown> {
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) record[key] = structuredClone(value);
	return record;
}

/** The inverse of `cloneAsRecord`, once the record has been given the shape of a node. */
export function recordAsNode(record: Record<string, unknown>): Node {
	return record as unknown as Node;
}
