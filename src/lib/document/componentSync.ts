// The entry point of the component engine for `document.apply`: what to append after changes were
// applied. Main-component edits reach their copies; instance property edits reach the layers
// bound to them. Both are ordinary changes in the triggering transaction.

import { planInstancePropertyEffects } from './componentProperties';
import { planMainSync } from './components';
import type { IdGenerator } from './ids';
import type { DocumentReader } from './store';
import type { Change, ComponentPropertyValue } from './types';

function previousProperties(
	change: Extract<Change, { t: 'set' }>
): Record<string, ComponentPropertyValue> | undefined {
	const previous = change.prev.componentProperties;
	if (typeof previous !== 'object' || previous === null) return undefined;
	return previous as Record<string, ComponentPropertyValue>;
}

export function planComponentAppend(
	reader: DocumentReader,
	applied: Change[],
	idGenerator?: IdGenerator
): Change[] {
	const out = planMainSync(reader, applied, idGenerator);
	for (const change of applied) {
		if (change.t !== 'set' || !Object.hasOwn(change.set, 'componentProperties')) continue;
		const node = reader.getNode(change.id);
		if (node === undefined) continue;
		out.push(...planInstancePropertyEffects(reader, node, previousProperties(change), idGenerator));
	}
	return out;
}
