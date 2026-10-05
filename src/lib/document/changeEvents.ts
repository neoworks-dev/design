// Shapes shared by `document.apply` and everything that listens to it. Pure: the kernel event
// declarations in src/lib/kernel/events.ts refer to these types.

import type { Change, ChangeOrigin, EntityKind, NodeId, Transaction } from './types';

/** What the caller says about a mutation. One `apply` call or one `transaction()` batch. */
export interface ApplyMeta {
	origin: ChangeOrigin;
	label: string;
	/** Identifies one plugin or AI run; history folds all its transactions into one step. */
	runId?: string;
	/** Coalesces consecutive transactions with the same key (nudges, typing). */
	mergeKey?: string;
	/** Resize with Ctrl held: frames do not apply their children constraints. */
	ignoreConstraints?: boolean;
	/** Set by history when it replays a transaction, so it does not record its own replay. */
	replay?: 'undo' | 'redo';
}

type EntityEventPrefix = Uppercase<EntityKind>;
export type EntityChangeType = `${EntityEventPrefix}_${'CREATE' | 'DELETE' | 'PROPERTY_CHANGE'}`;

/**
 * Granular, Figma-shaped change report (docs/research/plugin-api.md section 1). A move is a
 * PROPERTY_CHANGE of `parentId` and `index`.
 */
export type DocumentChange =
	| { type: 'CREATE'; id: NodeId; origin: ChangeOrigin }
	| { type: 'DELETE'; id: NodeId; origin: ChangeOrigin }
	| { type: 'PROPERTY_CHANGE'; id: NodeId; origin: ChangeOrigin; properties: string[] }
	| {
			type: EntityChangeType;
			kind: EntityKind;
			id: string;
			origin: ChangeOrigin;
			properties: string[];
	  };

export interface DocumentChangeEvent {
	transaction: Transaction;
	meta: ApplyMeta;
	/** Document revision after this commit. */
	revision: number;
	changes: DocumentChange[];
	/** Ids of nodes created, deleted or modified, for cache invalidation. */
	affectedNodeIds: NodeId[];
}

export interface DocumentReplaceEvent {
	revision: number;
	documentId: string;
}

/** Passed to `document/append` listeners: what was just applied, to derive follow-up changes. */
export interface AppendRequest {
	changes: Change[];
	meta: ApplyMeta;
}

const ENTITY_PREFIX: Record<EntityKind, EntityEventPrefix> = {
	style: 'STYLE',
	variable: 'VARIABLE',
	collection: 'COLLECTION',
	asset: 'ASSET'
};

function entityChangeType(
	kind: EntityKind,
	suffix: 'CREATE' | 'DELETE' | 'PROPERTY_CHANGE'
): EntityChangeType {
	return `${ENTITY_PREFIX[kind]}_${suffix}`;
}

/**
 * Turn applied changes into the granular report. `derivedFlags[i]` says change `i` was appended
 * by a `document/append` listener; those are reported with origin `sync`. Consecutive property
 * changes to one id are merged.
 */
export function toDocumentChanges(
	applied: Change[],
	derivedFlags: boolean[],
	origin: ChangeOrigin
): DocumentChange[] {
	const report: DocumentChange[] = [];
	const propertyChanges = new Map<string, Extract<DocumentChange, { properties: string[] }>>();
	applied.forEach((change, position) => {
		const changeOrigin: ChangeOrigin = derivedFlags[position] ? 'sync' : origin;
		switch (change.t) {
			case 'add':
				report.push({ type: 'CREATE', id: change.node.id, origin: changeOrigin });
				return;
			case 'del':
				report.push({ type: 'DELETE', id: change.node.id, origin: changeOrigin });
				return;
			case 'set':
				mergeProperties(report, propertyChanges, `node:${change.id}`, changeOrigin, {
					type: 'PROPERTY_CHANGE',
					id: change.id,
					origin: changeOrigin,
					properties: Object.keys(change.set)
				});
				return;
			case 'move':
				mergeProperties(report, propertyChanges, `node:${change.id}`, changeOrigin, {
					type: 'PROPERTY_CHANGE',
					id: change.id,
					origin: changeOrigin,
					properties: ['parentId', 'index']
				});
				return;
			case 'entity-add':
				report.push({
					type: entityChangeType(change.kind, 'CREATE'),
					kind: change.kind,
					id: change.entity.id,
					origin: changeOrigin,
					properties: []
				});
				return;
			case 'entity-del':
				report.push({
					type: entityChangeType(change.kind, 'DELETE'),
					kind: change.kind,
					id: change.entity.id,
					origin: changeOrigin,
					properties: []
				});
				return;
			case 'entity-set':
				mergeProperties(report, propertyChanges, `${change.kind}:${change.id}`, changeOrigin, {
					type: entityChangeType(change.kind, 'PROPERTY_CHANGE'),
					kind: change.kind,
					id: change.id,
					origin: changeOrigin,
					properties: Object.keys(change.set)
				});
				return;
		}
	});
	return report;
}

function mergeProperties(
	report: DocumentChange[],
	open: Map<string, Extract<DocumentChange, { properties: string[] }>>,
	key: string,
	origin: ChangeOrigin,
	next: Extract<DocumentChange, { properties: string[] }>
): void {
	const existing = open.get(key);
	if (existing && existing.origin === origin) {
		for (const property of next.properties) {
			if (!existing.properties.includes(property)) existing.properties.push(property);
		}
		return;
	}
	open.set(key, next);
	report.push(next);
}

export function affectedNodeIds(applied: Change[]): NodeId[] {
	const ids = new Set<NodeId>();
	for (const change of applied) {
		if (change.t === 'add' || change.t === 'del') ids.add(change.node.id);
		else if (change.t === 'set' || change.t === 'move') ids.add(change.id);
	}
	return [...ids];
}
