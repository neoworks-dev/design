// What a property panel control shows for a selection: one value, or "Mixed". Pure.

import type { Node } from '../document';
import { isSameValue } from '../inspectors/selection';

export interface InspectorValue<Value> {
	/** The shared value; `null` when the selection is empty or the values differ. */
	value: Value | null;
	mixed: boolean;
}

/** Read one value from every item: shared, or mixed when any two differ. */
export function sharedValue<Item, Value>(
	items: readonly Item[],
	read: (item: Item) => Value
): InspectorValue<Value> {
	if (items.length === 0) return { value: null, mixed: false };
	const first = read(items[0]);
	for (const item of items.slice(1)) {
		if (!isSameValue(first, read(item))) return { value: null, mixed: true };
	}
	return { value: first, mixed: false };
}

/** Id of the variable `property` is bound to on every node, or `null`. */
export function boundVariableId(nodes: readonly Node[], property: string): string | null {
	if (nodes.length === 0) return null;
	const ids = nodes.map((node) => {
		const alias = node.boundVariables?.[property];
		if (alias === undefined || Array.isArray(alias)) return null;
		return alias.id;
	});
	const [first] = ids;
	if (ids.some((id) => id !== first)) return null;
	return first;
}
