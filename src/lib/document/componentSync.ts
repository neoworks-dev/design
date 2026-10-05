// The entry point of the component engine for `document.apply`: what to append after changes were
// applied. Main-component edits reach their copies; instance property edits reach the layers
// bound to them. Both are ordinary changes in the triggering transaction.

import { applyChanges } from './apply';
import { planInstancePropertyEffects } from './componentProperties';
import { markTouched, planMainSync } from './components';
import type { IdGenerator } from './ids';
import type { DocumentReader, DocumentStore } from './store';
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

const MAX_ROUNDS = 8;

export interface ApplyWithSyncOptions {
	/** The changes replay a recorded transaction: they already contain every derived change. */
	replay?: boolean;
	idGenerator?: IdGenerator;
}

/**
 * Apply `changes` to a bare store the way `document.apply` does with the component plugin
 * mounted: touched marking first, then append rounds until nothing is left to derive. Returns
 * everything applied, own and derived, in order. For fixtures and tests that have no kernel.
 */
export function applyWithComponentSync(
	store: DocumentStore,
	changes: Change[],
	options: ApplyWithSyncOptions = {}
): Change[] {
	if (options.replay === true) return applyChanges(store, changes);
	const applied = applyChanges(store, markTouched(store, changes));
	const everything = [...applied];
	let pending = applied;
	for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round += 1) {
		const derived = planComponentAppend(store, pending, options.idGenerator);
		if (derived.length === 0) break;
		pending = applyChanges(store, derived);
		everything.push(...pending);
	}
	return everything;
}
