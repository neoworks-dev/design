// The `assets` and `fonts` tables as a blob store (data-model.md section 6). Images are keyed by
// the sha-256 of their bytes, so the same image added twice is one row. Records (mime, size)
// reach the document as entities through ordinary transactions, which never touch `bytes`; the
// bytes themselves are written here, straight to the table, because they are not change-set data.
//
// Garbage collection drops asset rows that no node or style references. It runs at checkpoint
// (Save), after the renderer flushed its queue, so a paint committed before Save is seen.

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AssetRecord } from '../../src/lib/document/types';
import { StoreError } from './errors';

export interface AssetInput {
	bytes: Uint8Array;
	mime: string;
	width?: number;
	height?: number;
}

export interface PutAssetResult {
	record: AssetRecord;
	/** False when the same bytes were already stored. */
	created: boolean;
}

export function hashBytes(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Store `input` under the hash of its bytes; storing the same bytes again changes nothing. */
export function putAsset(database: DatabaseSync, input: AssetInput): PutAssetResult {
	const hash = hashBytes(input.bytes);
	const width = input.width === undefined ? null : input.width;
	const height = input.height === undefined ? null : input.height;
	const existing = database.prepare('SELECT bytes FROM assets WHERE hash = ?').get(hash);
	if (existing !== undefined && existing.bytes instanceof Uint8Array) {
		return { record: readRecord(database, hash), created: false };
	}
	// A record without bytes exists when the document was written from another source; fill it.
	database
		.prepare(
			`INSERT INTO assets (hash, mime, width, height, bytes) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (hash) DO UPDATE SET bytes = excluded.bytes`
		)
		.run(hash, input.mime, width, height, input.bytes);
	return { record: readRecord(database, hash), created: existing === undefined };
}

function readRecord(database: DatabaseSync, hash: string): AssetRecord {
	const row = database.prepare('SELECT mime, width, height FROM assets WHERE hash = ?').get(hash);
	if (row === undefined) throw new StoreError('CORRUPT', `asset ${hash} vanished`);
	const record: AssetRecord = { id: hash, mime: String(row.mime) };
	if (typeof row.width === 'number') record.width = row.width;
	if (typeof row.height === 'number') record.height = row.height;
	return record;
}

const IMAGE_HASH_PATTERN = /"imageHash":"([0-9a-f]+)"/g;

/** Hashes that nodes or styles refer to through an image paint. */
export function referencedAssetHashes(database: DatabaseSync): Set<string> {
	const referenced = new Set<string>();
	for (const table of ['nodes', 'styles']) {
		const rows = database.prepare(`SELECT data FROM ${table} WHERE data LIKE '%imageHash%'`).all();
		for (const row of rows) {
			for (const match of String(row.data).matchAll(IMAGE_HASH_PATTERN)) referenced.add(match[1]);
		}
	}
	return referenced;
}

/** Delete asset rows nothing references; returns their hashes. */
export function collectUnreferencedAssets(database: DatabaseSync): string[] {
	const referenced = referencedAssetHashes(database);
	const remove = database.prepare('DELETE FROM assets WHERE hash = ?');
	const removed: string[] = [];
	for (const row of database.prepare('SELECT hash FROM assets').all()) {
		const hash = String(row.hash);
		if (referenced.has(hash)) continue;
		remove.run(hash);
		removed.push(hash);
	}
	return removed;
}

export interface FaceName {
	family: string;
	style: string;
}

/** Embed a font file: the face becomes (or stays) an `embedded` entry of the fonts table. */
export function embedFont(database: DatabaseSync, face: FaceName, bytes: Uint8Array): void {
	const existing = database
		.prepare('SELECT position FROM fonts WHERE family = ? AND style = ?')
		.get(face.family, face.style);
	if (existing !== undefined) {
		database
			.prepare(`UPDATE fonts SET source = 'embedded', bytes = ? WHERE position = ?`)
			.run(bytes, existing.position);
		return;
	}
	const last = database.prepare('SELECT max(position) AS last FROM fonts').get();
	const next = last !== undefined && typeof last.last === 'number' ? last.last + 1 : 0;
	database
		.prepare(
			`INSERT INTO fonts (position, family, style, source, bytes) VALUES (?, ?, ?, 'embedded', ?)`
		)
		.run(next, face.family, face.style, bytes);
}

export function readEmbeddedFontBytes(database: DatabaseSync, face: FaceName): Uint8Array | null {
	const row = database
		.prepare(`SELECT bytes FROM fonts WHERE family = ? AND style = ? AND source = 'embedded'`)
		.get(face.family, face.style);
	if (row === undefined || !(row.bytes instanceof Uint8Array)) return null;
	return row.bytes;
}

/** The faces that carry bytes in this file, in table order. */
export function listEmbeddedFonts(database: DatabaseSync): FaceName[] {
	const rows = database
		.prepare(
			`SELECT family, style FROM fonts WHERE source = 'embedded' AND bytes IS NOT NULL ORDER BY position`
		)
		.all();
	return rows.map((row) => ({ family: String(row.family), style: String(row.style) }));
}
