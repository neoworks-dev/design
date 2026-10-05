// Version history on top of the transaction log (data-model.md section 6: the append-only log is
// for "version history / crash recovery (prunable)").
//
// A version is a named position in the log: the `seq` of the newest logged transaction when it was
// made. Marks live in `meta` under `version.<id>` (JSON), so they need no schema change and travel
// with the file (Save As copies `meta`).
//
// Restoring to a position means undoing every transaction logged after it, newest first. That is
// possible exactly as long as none of those transactions was pruned. The log is pruned from the
// old end only (row cap and age, see transactionWriter.ts), so a position `seq` can be restored
// while the oldest remaining log row has `seq <= position + 1`.

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type {
	LogEntrySummary,
	RestorePlan,
	VersionHistoryData,
	VersionKind,
	VersionMark
} from '../bridge';
import type { Change } from '../../src/lib/document/types';
import { StoreError } from './errors';

const VERSION_KEY_PREFIX = 'version.';
/** Automatic marks (a session start, a Save) beyond this many are dropped, oldest first. */
export const MAX_AUTOMATIC_MARKS = 30;
/** The history list shows this many of the newest log entries. */
export const MAX_LISTED_ENTRIES = 300;

type Row = Record<string, SQLOutputValue>;

function numberOf(row: Row, key: string): number {
	const value = row[key];
	if (typeof value === 'number') return value;
	if (typeof value === 'bigint') return Number(value);
	throw new StoreError('CORRUPT', `column ${key} is not a number`);
}

function textOf(row: Row, key: string): string {
	const value = row[key];
	if (typeof value === 'string') return value;
	throw new StoreError('CORRUPT', `column ${key} is not text`);
}

/** The `seq` of the newest transaction ever logged (0 before the first); survives pruning. */
export function latestSeq(database: DatabaseSync): number {
	const row = database.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'").get();
	if (row === undefined) return 0;
	return numberOf(row, 'seq');
}

/** The `seq` of the oldest transaction still in the log; `latestSeq + 1` when it is empty. */
export function oldestSeq(database: DatabaseSync): number {
	const row = database.prepare('SELECT min(seq) AS oldest FROM transactions').get();
	if (row === undefined || row.oldest === null) return latestSeq(database) + 1;
	return numberOf(row, 'oldest');
}

function parseMark(value: string): VersionMark | null {
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const { id, name, kind, seq, createdAt } = parsed as Record<string, unknown>;
		if (typeof id !== 'string' || typeof name !== 'string') return null;
		if (kind !== 'named' && kind !== 'save' && kind !== 'session') return null;
		if (typeof seq !== 'number' || typeof createdAt !== 'number') return null;
		return { id, name, kind, seq, createdAt };
	} catch {
		return null;
	}
}

/** Every mark, oldest first. */
export function listMarks(database: DatabaseSync): VersionMark[] {
	const rows = database.prepare("SELECT value FROM meta WHERE key LIKE 'version.%'").all();
	const marks: VersionMark[] = [];
	for (const row of rows) {
		const mark = parseMark(textOf(row, 'value'));
		if (mark !== null) marks.push(mark);
	}
	return marks.sort((left, right) => left.seq - right.seq || left.createdAt - right.createdAt);
}

function writeMark(database: DatabaseSync, mark: VersionMark): void {
	database
		.prepare(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
		)
		.run(`${VERSION_KEY_PREFIX}${mark.id}`, JSON.stringify(mark));
}

function dropOldAutomaticMarks(database: DatabaseSync): void {
	const automatic = listMarks(database).filter((mark) => mark.kind !== 'named');
	const excess = automatic.length - MAX_AUTOMATIC_MARKS;
	for (const mark of automatic.slice(0, Math.max(excess, 0))) deleteMark(database, mark.id);
}

/**
 * Mark the current end of the log. Automatic marks (`save`, `session`) are skipped when nothing
 * was logged since the newest mark, so reopening or saving an untouched file adds nothing.
 * Returns the new mark, or `null` when skipped.
 */
export function addMark(
	database: DatabaseSync,
	request: { name: string; kind: VersionKind },
	now: number
): VersionMark | null {
	const seq = latestSeq(database);
	const marks = listMarks(database);
	const newest = marks[marks.length - 1];
	if (request.kind !== 'named' && newest !== undefined && newest.seq === seq) return null;
	const mark: VersionMark = {
		id: randomBytes(6).toString('hex'),
		name: request.name,
		kind: request.kind,
		seq,
		createdAt: now
	};
	writeMark(database, mark);
	if (request.kind !== 'named') dropOldAutomaticMarks(database);
	return mark;
}

export function deleteMark(database: DatabaseSync, id: string): void {
	database.prepare('DELETE FROM meta WHERE key = ?').run(`${VERSION_KEY_PREFIX}${id}`);
}

/** Marks, and the newest log entries as summaries (no change payloads), for the history list. */
export function versionHistory(database: DatabaseSync): VersionHistoryData {
	const rows = database
		.prepare(
			'SELECT seq, id, created_at, origin, label FROM transactions ORDER BY seq DESC LIMIT ?'
		)
		.all(MAX_LISTED_ENTRIES);
	const entries: LogEntrySummary[] = rows.reverse().map((row) => ({
		seq: numberOf(row, 'seq'),
		id: textOf(row, 'id'),
		createdAt: numberOf(row, 'created_at'),
		origin: textOf(row, 'origin'),
		label: textOf(row, 'label')
	}));
	return {
		latestSeq: latestSeq(database),
		oldestSeq: oldestSeq(database),
		marks: listMarks(database),
		entries
	};
}

/**
 * What undoes everything logged after `seq`, newest transaction first, as one change list. Not
 * `available` when part of that range was pruned.
 */
export function restorePlan(database: DatabaseSync, seq: number): RestorePlan {
	const latest = latestSeq(database);
	if (seq > latest || seq < 0) {
		throw new StoreError('CORRUPT', `position ${seq} is not in the log (latest is ${latest})`);
	}
	if (oldestSeq(database) > seq + 1) {
		return { available: false, changes: [], count: 0, latestSeq: latest };
	}
	const rows = database
		.prepare('SELECT seq, data FROM transactions WHERE seq > ? ORDER BY seq DESC')
		.all(seq);
	const changes: Change[] = [];
	for (const row of rows) {
		const data: unknown = JSON.parse(textOf(row, 'data'));
		if (typeof data !== 'object' || data === null || !('undo' in data)) {
			throw new StoreError('CORRUPT', `log entry ${numberOf(row, 'seq')} has no undo`);
		}
		changes.push(...(data.undo as Change[]));
	}
	return { available: true, changes, count: rows.length, latestSeq: latest };
}
