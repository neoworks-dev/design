// Schema migrations, keyed by `PRAGMA user_version` and mirrored in `meta.schema_version`.
// Each step runs in its own transaction and bumps both numbers, so a crash leaves the file at a
// whole version. To change the schema: append a migration with the next version number, bump
// SCHEMA_VERSION in src/lib/document/types.ts, and add a golden fixture and a step test.

import type { DatabaseSync } from 'node:sqlite';
import { APPLICATION_ID } from './constants';

export interface Migration {
	version: number;
	description: string;
	up(database: DatabaseSync): void;
}

/** Tables per data-model.md section 6; ids and JSON documents, one row per node. */
function createVersion1(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE meta (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT NOT NULL
		) WITHOUT ROWID;

		CREATE TABLE nodes (
			id TEXT PRIMARY KEY NOT NULL,
			parent_id TEXT,
			idx TEXT NOT NULL,
			type TEXT NOT NULL,
			data TEXT NOT NULL
		) WITHOUT ROWID;
		CREATE INDEX nodes_by_parent ON nodes (parent_id, idx);

		CREATE TABLE styles (
			id TEXT PRIMARY KEY NOT NULL,
			data TEXT NOT NULL
		) WITHOUT ROWID;

		CREATE TABLE variable_collections (
			id TEXT PRIMARY KEY NOT NULL,
			data TEXT NOT NULL
		) WITHOUT ROWID;

		CREATE TABLE variables (
			id TEXT PRIMARY KEY NOT NULL,
			data TEXT NOT NULL
		) WITHOUT ROWID;

		CREATE TABLE assets (
			hash TEXT PRIMARY KEY NOT NULL,
			mime TEXT NOT NULL,
			width INTEGER,
			height INTEGER,
			bytes BLOB
		) WITHOUT ROWID;

		CREATE TABLE fonts (
			position INTEGER PRIMARY KEY NOT NULL,
			family TEXT NOT NULL,
			style TEXT NOT NULL,
			source TEXT NOT NULL,
			bytes BLOB
		);

		CREATE TABLE transactions (
			seq INTEGER PRIMARY KEY AUTOINCREMENT,
			id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			origin TEXT NOT NULL,
			label TEXT NOT NULL,
			data TEXT NOT NULL
		);

		CREATE TABLE thumbnails (
			key TEXT PRIMARY KEY NOT NULL,
			mime TEXT NOT NULL,
			width INTEGER NOT NULL,
			height INTEGER NOT NULL,
			bytes BLOB NOT NULL,
			updated_at INTEGER NOT NULL
		) WITHOUT ROWID;
	`);
	// PRAGMA cannot take a bound parameter.
	database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
}

export const MIGRATIONS: readonly Migration[] = [
	{ version: 1, description: 'initial schema', up: createVersion1 }
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function readUserVersion(database: DatabaseSync): number {
	const row = database.prepare('PRAGMA user_version').get();
	if (row === undefined) return 0;
	const version = row.user_version;
	if (typeof version !== 'number') return 0;
	return version;
}

/**
 * Bring a database from its current version up to the last migration. Returns the versions that
 * were applied (empty when it was already current). `migrations` is a parameter so tests can
 * exercise a step in isolation.
 */
export function migrate(
	database: DatabaseSync,
	migrations: readonly Migration[] = MIGRATIONS
): number[] {
	const applied: number[] = [];
	const from = readUserVersion(database);
	for (const migration of migrations) {
		if (migration.version <= from) continue;
		runMigration(database, migration);
		applied.push(migration.version);
	}
	return applied;
}

function runMigration(database: DatabaseSync, migration: Migration): void {
	database.exec('BEGIN IMMEDIATE');
	try {
		migration.up(database);
		database
			.prepare(
				'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
			)
			.run('schema_version', String(migration.version));
		database.exec(`PRAGMA user_version = ${migration.version}`);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}
