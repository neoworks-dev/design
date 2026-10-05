// Test harness for the component engine (not shipped): a stand-in for `document.apply` that runs
// the same hooks the kernel does (touched marking before, append rounds after) and small fixtures.

import { applyChanges } from './apply';
import { planComponentAppend } from './componentSync';
import { planCreateInstance } from './componentOps';
import { markTouched } from './components';
import { keyBetween } from './fractionalIndex';
import { buildDocument, node, page, rectangle, text } from './fixtures';
import { sequentialIdGenerator } from './ids';
import { DocumentStore } from './store';
import type { Change, Node, NodeId, SceneNode } from './types';

export const RED = [
	{ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r: 1, g: 0, b: 0 } }
] as const;
export const BLUE = [
	{ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r: 0, g: 0, b: 1 } }
] as const;

export function paragraphs(content: string): never {
	return [
		{
			runs: [{ text: content, style: {} }],
			align: 'LEFT',
			indent: 0,
			spacingAfter: 0,
			list: 'NONE',
			listLevel: 0
		}
	] as never;
}

/**
 * Apply `changes` the way `document.apply` does with the component plugin mounted. Returns every
 * change that was applied, own and derived, in order: its inverse is the undo step.
 */
export function applyWithSync(
	store: DocumentStore,
	changes: Change[],
	options: { replay?: boolean; ids?: () => string } = {}
): Change[] {
	const input = options.replay === true ? changes : markTouched(store, changes);
	const applied = applyChanges(store, input);
	const everything = [...applied];
	if (options.replay === true) return everything;
	let pending = applied;
	for (let round = 0; round < 8 && pending.length > 0; round += 1) {
		const extra = planComponentAppend(store, pending, options.ids);
		if (extra.length === 0) break;
		pending = applyChanges(store, extra);
		everything.push(...pending);
	}
	return everything;
}

export function ids(prefix = 'c'): () => string {
	return sequentialIdGenerator(prefix);
}

export function snapshot(store: DocumentStore): string {
	const entries = Object.entries(store.document.nodes).sort(([left], [right]) =>
		left < right ? -1 : 1
	);
	return JSON.stringify(entries);
}

/** A valid fractional index after the last child of `parentId`. */
export function tail(store: DocumentStore, parentId: NodeId): string {
	return keyBetween(store.childNodes(parentId).at(-1)?.index ?? null, null);
}

export function get(store: DocumentStore, id: NodeId): SceneNode {
	const found = store.requireNode(id);
	if (found.type === 'PAGE') throw new Error('page');
	return found;
}

export function childByName(store: DocumentStore, parentId: NodeId, name: string): Node {
	const found = store.childNodes(parentId).find((child) => child.name === name);
	if (found === undefined) throw new Error(`no child ${name}`);
	return found;
}

/** Page `p` with component `M` ("Button": rect `bg`, text `label` "Hello") and a loose rect. */
export function storeWithMain(): DocumentStore {
	return new DocumentStore(
		buildDocument([
			page(
				'P',
				[
					node('COMPONENT', { id: 'M', name: 'Button', width: 100, height: 40, fills: [...BLUE] }, [
						rectangle({ id: 'bg', name: 'bg', width: 100, height: 40, fills: [...RED] }),
						text({ id: 'label', name: 'label', paragraphs: paragraphs('Hello') })
					]),
					rectangle({ id: 'loose', name: 'loose' })
				],
				{ id: 'p' }
			)
		])
	);
}

export function addInstance(store: DocumentStore, mainId = 'M', generate = ids()): string {
	const plan = planCreateInstance(store, mainId, { idGenerator: generate });
	applyChanges(store, plan.changes);
	return plan.rootId;
}
