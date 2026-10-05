// Incremental persistence: one committed document Transaction becomes one SQLite transaction that
// touches only the rows the changes affect, plus one row appended to the `transactions` log.
//
// Changes are replayed against an in-memory overlay of the rows they touch, so many changes to
// one node (a drag's worth of `set`s inside one transaction) cost one row write, and a row that
// ends up identical to what is stored (set then set back) is not written at all. The log row is
// skipped when the transaction id is already there, which makes a retried commit idempotent.

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type {
	AssetRecord,
	Change,
	EntityKind,
	Node,
	Transaction
} from '../../src/lib/document/types';
import { TRANSACTION_LOG_MAX_AGE_DAYS, TRANSACTION_LOG_MAX_ROWS } from './constants';
import { StoreError } from './errors';
import {
	assetToRow,
	entityToJsonRow,
	jsonRowToEntity,
	nodeToRow,
	rowToAsset,
	rowToNode,
	type NodeRow
} from './rows';

export interface WriteStats {
	/** Node and entity rows inserted, updated or deleted. */
	documentRows: number;
	/** Rows appended to the transaction log (0 when the transaction was already logged). */
	logRows: number;
	/** The transaction was already in the log and was skipped entirely. */
	duplicate: boolean;
}

type Row = Record<string, SQLOutputValue>;
type Entity = { id: string } & Record<string, unknown>;

/** Applies `set` to a copy of `target`; an `undefined` value removes the property. */
function withProperties<T extends object>(target: T, set: Record<string, unknown>): T {
	const copy = { ...target } as Record<string, unknown>;
	for (const [key, value] of Object.entries(set)) {
		if (value === undefined) {
			delete copy[key];
			continue;
		}
		copy[key] = value;
	}
	return copy as T;
}

function textOf(row: Row, key: string): string {
	const value = row[key];
	if (typeof value === 'string') return value;
	throw new StoreError('CORRUPT', `column ${key} is not text`);
}

function asNodeRow(row: Row): NodeRow {
	const parent = row.parent_id;
	return {
		id: textOf(row, 'id'),
		parent_id: typeof parent === 'string' ? parent : null,
		idx: textOf(row, 'idx'),
		type: textOf(row, 'type'),
		data: textOf(row, 'data')
	};
}

const JSON_ENTITY_TABLES: Record<Exclude<EntityKind, 'asset'>, string> = {
	style: 'styles',
	variable: 'variables',
	collection: 'variable_collections'
};

/** The current state of the rows one transaction touches; `null` means deleted. */
class Overlay {
	readonly nodes = new Map<string, { before: NodeRow | null; after: Node | null }>();
	readonly entities = new Map<
		string,
		{ kind: EntityKind; id: string; before: string | null; after: Entity | AssetRecord | null }
	>();

	constructor(private readonly database: DatabaseSync) {}

	node(id: string): Node | null {
		const entry = this.nodes.get(id);
		if (entry) return entry.after;
		const row = this.database
			.prepare('SELECT id, parent_id, idx, type, data FROM nodes WHERE id = ?')
			.get(id);
		const before = row === undefined ? null : asNodeRow(row);
		const after = before === null ? null : rowToNode(before);
		this.nodes.set(id, { before, after });
		return after;
	}

	setNode(id: string, node: Node | null): void {
		this.node(id);
		const entry = this.nodes.get(id);
		if (entry) entry.after = node;
	}

	entity(kind: EntityKind, id: string): Entity | AssetRecord | null {
		const key = `${kind}:${id}`;
		const entry = this.entities.get(key);
		if (entry) return entry.after;
		const loaded = this.loadEntity(kind, id);
		this.entities.set(key, { kind, id, before: loaded.serialized, after: loaded.entity });
		return loaded.entity;
	}

	setEntity(kind: EntityKind, id: string, entity: Entity | AssetRecord | null): void {
		this.entity(kind, id);
		const entry = this.entities.get(`${kind}:${id}`);
		if (entry) entry.after = entity;
	}

	private loadEntity(
		kind: EntityKind,
		id: string
	): { entity: Entity | AssetRecord | null; serialized: string | null } {
		if (kind === 'asset') {
			const row = this.database
				.prepare('SELECT hash, mime, width, height FROM assets WHERE hash = ?')
				.get(id);
			if (row === undefined) return { entity: null, serialized: null };
			const asset = rowToAsset({
				hash: textOf(row, 'hash'),
				mime: textOf(row, 'mime'),
				width: typeof row.width === 'number' ? row.width : null,
				height: typeof row.height === 'number' ? row.height : null
			});
			return { entity: asset, serialized: JSON.stringify(assetToRow(asset)) };
		}
		const table = JSON_ENTITY_TABLES[kind];
		const row = this.database.prepare(`SELECT id, data FROM ${table} WHERE id = ?`).get(id);
		if (row === undefined) return { entity: null, serialized: null };
		const data = textOf(row, 'data');
		return { entity: jsonRowToEntity<Entity>({ id, data }), serialized: data };
	}
}

function requireNode(overlay: Overlay, id: string): Node {
	const node = overlay.node(id);
	if (node === null) throw new StoreError('CORRUPT', `change refers to missing node ${id}`);
	return node;
}

function requireEntity(overlay: Overlay, kind: EntityKind, id: string): Entity | AssetRecord {
	const entity = overlay.entity(kind, id);
	if (entity === null) throw new StoreError('CORRUPT', `change refers to missing ${kind} ${id}`);
	return entity;
}

function replay(overlay: Overlay, change: Change): void {
	switch (change.t) {
		case 'add':
			overlay.setNode(change.node.id, change.node);
			return;
		case 'del':
			overlay.setNode(change.node.id, null);
			return;
		case 'set':
			overlay.setNode(change.id, withProperties(requireNode(overlay, change.id), change.set));
			return;
		case 'move': {
			const node = requireNode(overlay, change.id);
			overlay.setNode(change.id, { ...node, parentId: change.parent, index: change.index } as Node);
			return;
		}
		case 'entity-add':
			overlay.setEntity(change.kind, change.entity.id, change.entity as Entity | AssetRecord);
			return;
		case 'entity-del':
			overlay.setEntity(change.kind, change.entity.id, null);
			return;
		case 'entity-set':
			overlay.setEntity(
				change.kind,
				change.id,
				withProperties(requireEntity(overlay, change.kind, change.id), change.set)
			);
			return;
	}
}

function flushNodes(database: DatabaseSync, overlay: Overlay): number {
	let written = 0;
	const upsert = database.prepare(`
		INSERT INTO nodes (id, parent_id, idx, type, data) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id, idx = excluded.idx, data = excluded.data
	`);
	const remove = database.prepare('DELETE FROM nodes WHERE id = ?');
	for (const [id, { before, after }] of overlay.nodes) {
		if (after === null) {
			if (before !== null) written += Number(remove.run(id).changes);
			continue;
		}
		const row = nodeToRow(after);
		if (before !== null && before.parent_id === row.parent_id && before.idx === row.idx) {
			if (before.data === row.data) continue;
		}
		upsert.run(row.id, row.parent_id, row.idx, row.type, row.data);
		written += 1;
	}
	return written;
}

function flushEntities(database: DatabaseSync, overlay: Overlay): number {
	let written = 0;
	for (const entry of overlay.entities.values()) {
		written += flushEntity(database, entry);
	}
	return written;
}

function flushEntity(
	database: DatabaseSync,
	entry: { kind: EntityKind; id: string; before: string | null; after: Entity | AssetRecord | null }
): number {
	if (entry.kind === 'asset') return flushAsset(database, entry);
	const table = JSON_ENTITY_TABLES[entry.kind];
	if (entry.after === null) {
		if (entry.before === null) return 0;
		return Number(database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(entry.id).changes);
	}
	const row = entityToJsonRow(entry.after as Entity);
	if (row.data === entry.before) return 0;
	database
		.prepare(
			`INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data`
		)
		.run(row.id, row.data);
	return 1;
}

function flushAsset(
	database: DatabaseSync,
	entry: { id: string; before: string | null; after: Entity | AssetRecord | null }
): number {
	if (entry.after === null) {
		if (entry.before === null) return 0;
		return Number(database.prepare('DELETE FROM assets WHERE hash = ?').run(entry.id).changes);
	}
	const row = assetToRow(entry.after as AssetRecord);
	if (JSON.stringify(row) === entry.before) return 0;
	// `bytes` is never touched here: a record change must not drop the stored image.
	database
		.prepare(
			`INSERT INTO assets (hash, mime, width, height) VALUES (?, ?, ?, ?)
			 ON CONFLICT (hash) DO UPDATE SET mime = excluded.mime, width = excluded.width, height = excluded.height`
		)
		.run(row.hash, row.mime, row.width, row.height);
	return 1;
}

function logTransaction(database: DatabaseSync, transaction: Transaction, now: number): number {
	const result = database
		.prepare(
			`INSERT INTO transactions (id, created_at, origin, label, data) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO NOTHING`
		)
		.run(
			transaction.id,
			now,
			transaction.origin,
			transaction.label,
			JSON.stringify({
				changes: transaction.changes,
				undo: transaction.undo,
				runId: transaction.runId
			})
		);
	return Number(result.changes);
}

/** True when the transaction is already in the log (a retry of one that did commit). */
function alreadyLogged(database: DatabaseSync, id: string): boolean {
	return (
		database.prepare('SELECT 1 AS present FROM transactions WHERE id = ?').get(id) !== undefined
	);
}

/**
 * Write `transaction` inside the connection's current SQLite transaction (the caller wraps it in
 * `BEGIN`/`COMMIT`). Throws on a change that does not fit the stored rows, which rolls the whole
 * transaction back.
 */
export function writeTransaction(
	database: DatabaseSync,
	transaction: Transaction,
	now: number
): WriteStats {
	if (alreadyLogged(database, transaction.id)) {
		return { documentRows: 0, logRows: 0, duplicate: true };
	}
	const overlay = new Overlay(database);
	for (const change of transaction.changes) replay(overlay, change);
	const documentRows = flushNodes(database, overlay) + flushEntities(database, overlay);
	const logRows = logTransaction(database, transaction, now);
	return { documentRows, logRows, duplicate: false };
}

/** Keep the log to its row cap and age limit (data-model.md section 7). Returns rows removed. */
export function pruneTransactionLog(
	database: DatabaseSync,
	now: number,
	limits: { maxRows: number; maxAgeDays: number } = {
		maxRows: TRANSACTION_LOG_MAX_ROWS,
		maxAgeDays: TRANSACTION_LOG_MAX_AGE_DAYS
	}
): number {
	const cutoff = now - limits.maxAgeDays * 24 * 60 * 60 * 1000;
	const byAge = database.prepare('DELETE FROM transactions WHERE created_at < ?').run(cutoff);
	const byCount = database
		.prepare(`DELETE FROM transactions WHERE seq <= (SELECT max(seq) FROM transactions) - ?`)
		.run(limits.maxRows);
	return Number(byAge.changes) + Number(byCount.changes);
}
