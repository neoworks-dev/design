// Planning for the layers panel's row actions: the eye and lock toggles (one layer, or with Alt
// its siblings) and the search filter. Pure: reads a `DocumentReader`, returns changes or ids.

import {
	planSetProps,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type NodeType
} from '../document';

export type LayerFlag = 'visible' | 'locked';

function flagOf(node: Node, flag: LayerFlag): boolean {
	const value: unknown = Reflect.get(node, flag);
	return value === true;
}

function hasFlag(node: Node): boolean {
	return node.type !== 'PAGE';
}

/** Flip one layer's flag. */
export function planToggleFlag(reader: DocumentReader, id: NodeId, flag: LayerFlag): Change[] {
	const node = reader.requireNode(id);
	if (!hasFlag(node)) return [];
	return planSetProps(reader, id, { [flag]: !flagOf(node, flag) });
}

/**
 * Alt+click: isolate the layer among its siblings. Hiding isolates by hiding the others, locking
 * by locking the others; when the others are already isolated that way, everything goes back to
 * shown / unlocked. The clicked layer itself ends up shown / unlocked in both cases.
 */
export function planIsolateFlag(reader: DocumentReader, id: NodeId, flag: LayerFlag): Change[] {
	const node = reader.requireNode(id);
	if (node.parentId === null) return [];
	const othersValue = flag === 'locked';
	const others = reader.childNodes(node.parentId).filter((sibling) => sibling.id !== id);
	const alreadyIsolated = others.every((sibling) => flagOf(sibling, flag) === othersValue);
	const changes = planSetProps(reader, id, { [flag]: flag === 'visible' });
	for (const sibling of others) {
		if (!hasFlag(sibling)) continue;
		changes.push(
			...planSetProps(reader, sibling.id, { [flag]: alreadyIsolated ? !othersValue : othersValue })
		);
	}
	return changes;
}

// ---------- filter ----------

export type LayerTypeFilter = 'frame' | 'group' | 'component' | 'text' | 'shape' | 'image';

export const LAYER_TYPE_FILTERS: ReadonlyArray<{ id: LayerTypeFilter; title: string }> = [
	{ id: 'frame', title: 'Frames' },
	{ id: 'group', title: 'Groups' },
	{ id: 'component', title: 'Components' },
	{ id: 'text', title: 'Text' },
	{ id: 'shape', title: 'Shapes' },
	{ id: 'image', title: 'Images' }
];

export interface LayerFilter {
	query: string;
	types: readonly LayerTypeFilter[];
}

export function isFilterActive(filter: LayerFilter): boolean {
	return filter.query.trim().length > 0 || filter.types.length > 0;
}

const FILTER_BY_TYPE: Partial<Record<NodeType, LayerTypeFilter>> = {
	FRAME: 'frame',
	SECTION: 'frame',
	GROUP: 'group',
	BOOLEAN_OPERATION: 'group',
	COMPONENT: 'component',
	COMPONENT_SET: 'component',
	INSTANCE: 'component',
	TEXT: 'text'
};

function hasImageFill(node: Node): boolean {
	const fills: unknown = Reflect.get(node, 'fills');
	if (!Array.isArray(fills)) return false;
	return fills.some((fill: unknown) => Reflect.get(Object(fill), 'type') === 'IMAGE');
}

function categoriesOf(node: Node): LayerTypeFilter[] {
	const categories: LayerTypeFilter[] = [];
	if (hasImageFill(node)) categories.push('image');
	const byType = FILTER_BY_TYPE[node.type];
	if (byType !== undefined) categories.push(byType);
	else categories.push('shape');
	return categories;
}

function matchesFilter(node: Node, needle: string, types: readonly LayerTypeFilter[]): boolean {
	if (needle.length > 0 && !node.name.toLowerCase().includes(needle)) return false;
	if (types.length === 0) return true;
	return categoriesOf(node).some((category) => types.includes(category));
}

/**
 * The layers to list while filtering: every match under `pageId` together with its ancestors, so
 * a match is shown in context. `null` when no filter is active (list everything).
 */
export function layersMatching(
	reader: DocumentReader,
	pageId: NodeId,
	filter: LayerFilter
): Set<NodeId> | null {
	if (!isFilterActive(filter)) return null;
	const needle = filter.query.trim().toLowerCase();
	const listed = new Set<NodeId>();
	for (const node of reader.descendants(pageId)) {
		if (!matchesFilter(node, needle, filter.types)) continue;
		listed.add(node.id);
		for (const ancestor of reader.ancestors(node.id)) {
			if (ancestor.id === pageId || listed.has(ancestor.id)) break;
			listed.add(ancestor.id);
		}
	}
	return listed;
}
