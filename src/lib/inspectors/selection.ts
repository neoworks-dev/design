// Pure helpers for property-panel sections: what the selection looks like (`summarizeSelection`)
// and the "mixed" value rule (`readProperty`). No Svelte, no kernel.
//
//   const fillOpacity = readProperty(nodes, (node) => node.opacity);
//   if (fillOpacity === MIXED) showDash();

import type { Node, NodeId, NodeType } from '../document';

/** Marker returned by `readProperty` when the selected nodes disagree. */
export const MIXED: unique symbol = Symbol('mixed');
export type Mixed = typeof MIXED;

/** The selection as property sections see it. */
export interface InspectorSelection {
	count: number;
	/** Distinct node types in the selection, in order of first appearance. */
	kinds: NodeType[];
	/** The one type when all selected nodes share it, `mixed` otherwise, `none` when empty. */
	kind: NodeType | 'mixed' | 'none';
	/** True when every selected node has the same parent (and there is at least one node). */
	sharedParent: boolean;
	/** That shared parent, or null. */
	parentId: NodeId | null;
	hasInstance: boolean;
	/** Any component or component set (a main component, not an instance). */
	hasComponent: boolean;
	hasText: boolean;
}

export function summarizeSelection(nodes: readonly Node[]): InspectorSelection {
	const kinds: NodeType[] = [];
	for (const node of nodes) {
		if (!kinds.includes(node.type)) kinds.push(node.type);
	}
	const parentId = commonParentId(nodes);
	return {
		count: nodes.length,
		kinds,
		kind: summaryKind(kinds),
		sharedParent: parentId !== null,
		parentId,
		hasInstance: kinds.includes('INSTANCE'),
		hasComponent: kinds.includes('COMPONENT') || kinds.includes('COMPONENT_SET'),
		hasText: kinds.includes('TEXT')
	};
}

function summaryKind(kinds: NodeType[]): NodeType | 'mixed' | 'none' {
	if (kinds.length === 0) return 'none';
	if (kinds.length === 1) return kinds[0];
	return 'mixed';
}

function commonParentId(nodes: readonly Node[]): NodeId | null {
	if (nodes.length === 0) return null;
	const [first] = nodes;
	if (first.parentId === null) return null;
	const shared = nodes.every((node) => node.parentId === first.parentId);
	if (!shared) return null;
	return first.parentId;
}

/** Structural equality for plain data (paints, effects, numbers): what "same value" means. */
export function isSameValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== 'object' || typeof right !== 'object') return false;
	if (left === null || right === null) return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const leftKeys = Object.keys(left);
	if (leftKeys.length !== Object.keys(right).length) return false;
	return leftKeys.every((key) => isSameValue(Reflect.get(left, key), Reflect.get(right, key)));
}

/**
 * The value of a property across the selection: the shared value, `MIXED` when nodes diverge,
 * and `undefined` for an empty selection.
 */
export function readProperty<Value>(
	nodes: readonly Node[],
	accessor: (node: Node) => Value
): Value | Mixed | undefined {
	if (nodes.length === 0) return undefined;
	const first = accessor(nodes[0]);
	for (let position = 1; position < nodes.length; position += 1) {
		if (!isSameValue(first, accessor(nodes[position]))) return MIXED;
	}
	return first;
}
