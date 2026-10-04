// One open `.ndesign` file: a SQLite database behind Node's built-in `node:sqlite`
// (data-model.md section 6). Synchronous by design: calls are short, run in the main process and
// never on the renderer's thread.
//
//   const file = DocumentFile.create(path, document);   // a new file with every row written
//   const file = DocumentFile.open(path);               // validates, migrates, WAL
//   const document = file.load();                       // whole document, schema-checked
//   file.close();                                       // checkpoints the WAL

import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { createBlankDocument } from '../../src/lib/document/blank';
import { parseDesignDocument } from '../../src/lib/document/schema';
import type {
	AssetRecord,
	DesignDocument,
	FontReference,
	Node,
	PageNode,
	Style,
	Transaction,
	Variable,
	VariableCollection
} from '../../src/lib/document/types';
import type { Thumbnail } from '../bridge';
import { APPLICATION_ID, OPEN_PRAGMAS } from './constants';
import {
	collectUnreferencedAssets,
	embedFont,
	listEmbeddedFonts,
	putAsset,
	readEmbeddedFontBytes,
	type AssetInput,
	type FaceName,
	type PutAssetResult
} from './assetStore';
import { asStoreError, StoreError } from './errors';
import { pruneTransactionLog, writeTransaction, type WriteStats } from './transactionWriter';
import { readHeader, requireDesignFile } from './header';
import { LATEST_SCHEMA_VERSION, migrate, readUserVersion } from './migrations';
import {
	assetToRow,
	entityToJsonRow,
	jsonRowToEntity,
	nodeToRow,
	rowToAsset,
	rowToNode,
	type AssetRow,
	type JsonEntityRow,
	type NodeRow
} from './rows';

/** What a file says about itself, without loading its nodes. */
export interface FileInfo {
	path: string;
	documentId: string;
	name: string;
	schemaVersion: number;
	/** Milliseconds since the epoch. */
	createdAt: number;
	modifiedAt: number;
	/** The previous session left this file without closing it cleanly (crash, kill). */
	recovered: boolean;
	/** Edits were committed since the last checkpoint (Save), possibly in an earlier session. */
	unsaved: boolean;
}

export interface OpenOptions {
	/**
	 * Take part in the crash-recovery protocol (default). A file opened with `session: false` is
	 * only inspected: it neither sets nor clears the unclean-session marker.
	 */
	session?: boolean;
}

/** One entry of the transaction log. */
export interface LoggedTransaction {
	seq: number;
	id: string;
	createdAt: number;
	origin: string;
	label: string;
	changes: Transaction['changes'];
	undo: Transaction['undo'];
}

/** The nodes of one page, the unit the loader streams. */
export interface PageChunk {
	page: PageNode;
	/** The page itself first, then every node below it, parents before children. */
	nodes: Node[];
}

type Row = Record<string, SQLOutputValue>;

function textOf(row: Row, key: string): string {
	const value = row[key];
	if (typeof value === 'string') return value;
	throw new StoreError('CORRUPT', `column ${key} is not text`);
}

function numberOrNull(row: Row, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return value;
	if (typeof value === 'bigint') return Number(value);
	throw new StoreError('CORRUPT', `column ${key} is not a number`);
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

export function removeFileAndSidecars(path: string): void {
	for (const suffix of ['', '-wal', '-shm', '-journal'])
		rmSync(`${path}${suffix}`, { force: true });
}

const TRANSACTION_LOG_LIMIT = 1000;
const SESSION_KEY = 'session_open';
const UNSAVED_KEY = 'unsaved';
/** The log is pruned every this many commits, and on open and close. */
const PRUNE_EVERY_COMMITS = 100;

export class DocumentFile {
	private database: DatabaseSync | null;
	private unsaved = false;
	private commitsSincePrune = 0;

	private constructor(
		readonly path: string,
		database: DatabaseSync,
		private readonly ownsSession: boolean,
		private readonly recovered: boolean
	) {
		this.database = database;
	}

	// ---------- opening and creating ----------

	/**
	 * Create a new file holding `document` (a blank one when omitted). Fails with
	 * ALREADY_EXISTS unless `overwrite` is set.
	 */
	static create(
		path: string,
		document: DesignDocument = createBlankDocument(),
		options: { overwrite?: boolean } = {}
	): DocumentFile {
		if (existsSync(path)) {
			if (options.overwrite !== true) {
				throw new StoreError('ALREADY_EXISTS', `${path} already exists`);
			}
			removeFileAndSidecars(path);
		}
		const database = new DatabaseSync(path);
		try {
			DocumentFile.configure(database);
			migrate(database);
			const file = new DocumentFile(path, database, true, false);
			file.writeDocument(document);
			file.markSessionOpen();
			// The header (application id, version) is only in the main file after a checkpoint;
			// without this a crash right after creation would leave a file the header check
			// cannot recognise.
			database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
			return file;
		} catch (error) {
			database.close();
			removeFileAndSidecars(path);
			throw asStoreError(error, path);
		}
	}

	/**
	 * Open an existing file. Anything that is not a design file, or that a newer version wrote, is
	 * refused from the 100-byte header alone, before a connection exists, so it is never written.
	 */
	static open(path: string, options: OpenOptions = {}): DocumentFile {
		if (!existsSync(path)) throw new StoreError('NOT_FOUND', `${path} does not exist`);
		const verifyAfterOpen = DocumentFile.checkHeader(path);
		const database = new DatabaseSync(path);
		try {
			DocumentFile.configure(database);
			if (verifyAfterOpen) DocumentFile.assertApplicationId(path, database);
			const version = readUserVersion(database);
			DocumentFile.assertSupported(path, version);
			if (migrate(database).length > 0) database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
			return DocumentFile.adopt(path, database, options.session !== false);
		} catch (error) {
			database.close();
			throw asStoreError(error, path);
		}
	}

	private static adopt(path: string, database: DatabaseSync, session: boolean): DocumentFile {
		const probe = new DocumentFile(path, database, false, false);
		const meta = probe.readMeta();
		const recovered = meta.has(SESSION_KEY);
		const file = new DocumentFile(path, database, session, recovered);
		file.unsaved = meta.get(UNSAVED_KEY) === '1';
		if (session) {
			file.markSessionOpen();
			file.pruneLog(Date.now());
		}
		return file;
	}

	/**
	 * Refuse from the header alone what is clearly not ours. A header that says "no application id"
	 * next to a non-empty WAL may just be stale (the id sits in the WAL after a crash), so that
	 * case is let through and verified through SQL after opening: returns true for it.
	 */
	private static checkHeader(path: string): boolean {
		try {
			const header = readHeader(path);
			if (header.applicationId === 0 && DocumentFile.hasPendingWal(path)) return true;
			requireDesignFile(path);
			DocumentFile.assertSupported(path, header.userVersion);
			return false;
		} catch (error) {
			throw asStoreError(error, path);
		}
	}

	private static hasPendingWal(path: string): boolean {
		try {
			return statSync(`${path}-wal`).size > 0;
		} catch {
			return false;
		}
	}

	private static assertApplicationId(path: string, database: DatabaseSync): void {
		const row = database.prepare('PRAGMA application_id').get();
		if (row !== undefined && row.application_id === APPLICATION_ID) return;
		throw new StoreError('NOT_A_DESIGN_FILE', `${path} is a database, but not a design file`);
	}

	private static assertSupported(path: string, version: number): void {
		if (version <= LATEST_SCHEMA_VERSION) return;
		throw new StoreError(
			'NEWER_VERSION',
			`${path} was saved by a newer version of the app (file format ${version}, this version reads up to ${LATEST_SCHEMA_VERSION}); update the app to open it`
		);
	}

	private static configure(database: DatabaseSync): void {
		for (const pragma of OPEN_PRAGMAS) database.exec(pragma);
	}

	// ---------- reading ----------

	info(): FileInfo {
		const meta = this.readMeta();
		return {
			path: this.path,
			documentId: this.requiredMeta(meta, 'file_id'),
			name: this.requiredMeta(meta, 'name'),
			schemaVersion: Number(this.requiredMeta(meta, 'schema_version')),
			createdAt: Number(this.requiredMeta(meta, 'created_at')),
			modifiedAt: Number(this.requiredMeta(meta, 'modified_at')),
			recovered: this.recovered,
			unsaved: this.unsaved
		};
	}

	/** Every row, assembled into one schema-checked document. */
	load(): DesignDocument {
		try {
			return this.loadUnchecked();
		} catch (error) {
			throw asStoreError(error, this.path);
		}
	}

	/** Pages in order, each with its nodes: the loader's unit, so first paint need not wait. */
	*pages(): Generator<PageChunk> {
		const db = this.requireOpen();
		const pageRows = db
			.prepare(
				'SELECT id, parent_id, idx, type, data FROM nodes WHERE parent_id IS NULL ORDER BY idx, id'
			)
			.all();
		const subtree = db.prepare(`
			WITH RECURSIVE subtree (id, depth) AS (
				SELECT id, 0 FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id, subtree.depth + 1 FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
			)
			SELECT nodes.id, nodes.parent_id, nodes.idx, nodes.type, nodes.data
			FROM subtree JOIN nodes ON nodes.id = subtree.id
			ORDER BY subtree.depth, nodes.idx, nodes.id
		`);
		for (const pageRow of pageRows) {
			const page = rowToNode(asNodeRow(pageRow));
			if (page.type !== 'PAGE') {
				throw new StoreError('CORRUPT', `${this.path}: root node ${page.id} is a ${page.type}`);
			}
			const nodes = subtree.all(page.id).map((row) => rowToNode(asNodeRow(row)));
			yield { page, nodes };
		}
	}

	/** The stored bytes of an asset (an image), or `null` while only its record exists. */
	readAssetBytes(hash: string): Uint8Array | null {
		const row = this.requireOpen().prepare('SELECT bytes FROM assets WHERE hash = ?').get(hash);
		if (row === undefined) return null;
		const bytes = row.bytes;
		if (bytes instanceof Uint8Array) return bytes;
		return null;
	}

	writeAssetBytes(hash: string, bytes: Uint8Array): void {
		const result = this.requireOpen()
			.prepare('UPDATE assets SET bytes = ? WHERE hash = ?')
			.run(bytes, hash);
		if (result.changes === 0)
			throw new StoreError('CORRUPT', `no asset record ${hash} to hold bytes`);
	}

	/** Store image bytes under their content hash (see assetStore.ts); same bytes, same row. */
	putAsset(input: AssetInput): PutAssetResult {
		return this.transact((database) => putAsset(database, input));
	}

	/** Delete asset rows no node or style references; returns their hashes. */
	collectAssets(): string[] {
		return this.transact((database) => collectUnreferencedAssets(database));
	}

	embedFont(face: FaceName, bytes: Uint8Array): void {
		this.transact((database) => embedFont(database, face, bytes));
	}

	readEmbeddedFont(face: FaceName): Uint8Array | null {
		return readEmbeddedFontBytes(this.requireOpen(), face);
	}

	embeddedFonts(): FaceName[] {
		return listEmbeddedFonts(this.requireOpen());
	}

	/** The stored preview under `key` (the file's own is `file`), or `null`. */
	readThumbnail(key: string): Thumbnail | null {
		const row = this.requireOpen()
			.prepare('SELECT mime, width, height, bytes FROM thumbnails WHERE key = ?')
			.get(key);
		if (row === undefined) return null;
		const bytes = row.bytes;
		if (!(bytes instanceof Uint8Array)) return null;
		const width = numberOrNull(row, 'width');
		const height = numberOrNull(row, 'height');
		if (width === null || height === null) return null;
		return { mime: textOf(row, 'mime'), width, height, bytes };
	}

	writeThumbnail(key: string, thumbnail: Thumbnail, now = Date.now()): void {
		this.requireOpen()
			.prepare(
				`INSERT INTO thumbnails (key, mime, width, height, bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (key) DO UPDATE SET mime = excluded.mime, width = excluded.width,
				 height = excluded.height, bytes = excluded.bytes, updated_at = excluded.updated_at`
			)
			.run(key, thumbnail.mime, thumbnail.width, thumbnail.height, thumbnail.bytes, now);
	}

	// ---------- closing ----------

	get isOpen(): boolean {
		return this.database !== null;
	}

	/**
	 * Clear the unclean-session marker, checkpoint the WAL into the main file and close. Safe to
	 * call twice. Not calling it (a crash) is exactly what leaves the marker for the next open.
	 */
	close(): void {
		const database = this.database;
		if (database === null) return;
		try {
			if (this.ownsSession) {
				this.pruneLog(Date.now());
				database.prepare('DELETE FROM meta WHERE key = ?').run(SESSION_KEY);
			}
			database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		} finally {
			this.database = null;
			database.close();
		}
	}

	// ---------- persistence ----------

	/**
	 * Persist one committed document transaction: only the rows its changes touch are written,
	 * plus one row in the transaction log, all in one SQLite transaction. Committing a
	 * transaction that is already logged does nothing (a retry after a lost reply).
	 */
	commit(transaction: Transaction, now = Date.now()): WriteStats {
		const stats = this.transact((database) => {
			const written = writeTransaction(database, transaction, now);
			if (!written.duplicate) this.touchMeta(database, now);
			return written;
		});
		this.commitsSincePrune += 1;
		if (this.commitsSincePrune >= PRUNE_EVERY_COMMITS) this.pruneLog(now);
		return stats;
	}

	/**
	 * Save: fold the WAL into the main file and clear the unsaved marker. Everything was already
	 * persisted per transaction; this makes the file self-contained and marks the document saved.
	 */
	checkpoint(now = Date.now()): FileInfo {
		const database = this.requireOpen();
		this.transact((open) => {
			collectUnreferencedAssets(open);
			this.setMeta(open, UNSAVED_KEY, '0');
			this.setMeta(open, 'modified_at', String(now));
		});
		this.unsaved = false;
		database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		return this.info();
	}

	/**
	 * Save As: write a consistent copy of this file to `destination`, replacing what is there, as
	 * a file that has never been opened: no session marker, nothing unsaved, `name` as its name.
	 * Built next to the destination and renamed into place, so a crash never leaves a half copy.
	 */
	saveCopyTo(destination: string, name: string, now = Date.now()): void {
		const database = this.requireOpen();
		const staging = `${destination}.saving`;
		removeFileAndSidecars(staging);
		try {
			database.prepare('VACUUM INTO ?').run(staging);
			const copy = new DatabaseSync(staging);
			try {
				copy.exec('PRAGMA journal_mode = DELETE');
				copy.prepare('DELETE FROM meta WHERE key = ?').run(SESSION_KEY);
				this.setMeta(copy, UNSAVED_KEY, '0');
				this.setMeta(copy, 'name', name);
				this.setMeta(copy, 'modified_at', String(now));
			} finally {
				copy.close();
			}
			removeFileAndSidecars(destination);
			renameSync(staging, destination);
		} catch (error) {
			removeFileAndSidecars(staging);
			throw asStoreError(error, destination);
		}
	}

	/** The newest `limit` log entries, oldest first. */
	transactionLog(limit = TRANSACTION_LOG_LIMIT): LoggedTransaction[] {
		const rows = this.requireOpen()
			.prepare(
				'SELECT seq, id, created_at, origin, label, data FROM transactions ORDER BY seq DESC LIMIT ?'
			)
			.all(limit);
		return rows.reverse().map((row) => {
			const data: unknown = JSON.parse(textOf(row, 'data'));
			if (typeof data !== 'object' || data === null) {
				throw new StoreError('CORRUPT', `log entry ${textOf(row, 'id')} is not an object`);
			}
			const logged = data as { changes: Transaction['changes']; undo: Transaction['undo'] };
			return {
				seq: Number(row.seq),
				id: textOf(row, 'id'),
				createdAt: Number(row.created_at),
				origin: textOf(row, 'origin'),
				label: textOf(row, 'label'),
				changes: logged.changes,
				undo: logged.undo
			};
		});
	}

	/** Drop log entries beyond the row cap or older than the age limit. */
	pruneLog(now = Date.now()): number {
		this.commitsSincePrune = 0;
		return pruneTransactionLog(this.requireOpen(), now);
	}

	// ---------- internals ----------

	private markSessionOpen(): void {
		this.setMeta(this.requireOpen(), SESSION_KEY, String(Date.now()));
	}

	private touchMeta(database: DatabaseSync, now: number): void {
		this.setMeta(database, 'modified_at', String(now));
		if (this.unsaved) return;
		this.setMeta(database, UNSAVED_KEY, '1');
		this.unsaved = true;
	}

	private setMeta(database: DatabaseSync, key: string, value: string): void {
		database
			.prepare(
				'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
			)
			.run(key, value);
	}

	/** The open connection, for the persistence layer that extends this class's work. */
	requireOpen(): DatabaseSync {
		if (this.database === null) throw new StoreError('CLOSED', `${this.path} is closed`);
		return this.database;
	}

	/** Run `work` in one SQLite transaction: all of it commits or none of it does. */
	transact<T>(work: (database: DatabaseSync) => T): T {
		const database = this.requireOpen();
		database.exec('BEGIN IMMEDIATE');
		try {
			const result = work(database);
			database.exec('COMMIT');
			return result;
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}
	}

	private readMeta(): Map<string, string> {
		const rows = this.requireOpen().prepare('SELECT key, value FROM meta').all();
		return new Map(rows.map((row) => [textOf(row, 'key'), textOf(row, 'value')]));
	}

	private requiredMeta(meta: Map<string, string>, key: string): string {
		const value = meta.get(key);
		if (value === undefined) throw new StoreError('CORRUPT', `${this.path} has no ${key}`);
		return value;
	}

	private writeDocument(document: DesignDocument): void {
		const now = Date.now();
		this.transact((database) => {
			this.writeMeta(database, document, now);
			this.writeNodes(database, document);
			this.writeEntities(database, document);
			this.writeFonts(database, document.fonts);
		});
	}

	private writeMeta(database: DatabaseSync, document: DesignDocument, now: number): void {
		const upsert = database.prepare(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
		);
		upsert.run('file_id', document.id);
		upsert.run('name', document.name);
		upsert.run('created_at', String(now));
		upsert.run('modified_at', String(now));
	}

	private writeNodes(database: DatabaseSync, document: DesignDocument): void {
		const insert = database.prepare(
			'INSERT INTO nodes (id, parent_id, idx, type, data) VALUES (?, ?, ?, ?, ?)'
		);
		for (const node of Object.values(document.nodes)) {
			const row = nodeToRow(node);
			insert.run(row.id, row.parent_id, row.idx, row.type, row.data);
		}
	}

	private writeEntities(database: DatabaseSync, document: DesignDocument): void {
		const tables: [string, Record<string, { id: string }>][] = [
			['styles', document.styles],
			['variable_collections', document.variableCollections],
			['variables', document.variables]
		];
		for (const [table, entities] of tables) {
			const insert = database.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`);
			for (const entity of Object.values(entities)) {
				const row = entityToJsonRow(entity);
				insert.run(row.id, row.data);
			}
		}
		const insertAsset = database.prepare(
			'INSERT INTO assets (hash, mime, width, height) VALUES (?, ?, ?, ?)'
		);
		for (const asset of Object.values(document.assets)) {
			const row = assetToRow(asset);
			insertAsset.run(row.hash, row.mime, row.width, row.height);
		}
	}

	private writeFonts(database: DatabaseSync, fonts: FontReference[]): void {
		database.exec('DELETE FROM fonts');
		const insert = database.prepare(
			'INSERT INTO fonts (position, family, style, source) VALUES (?, ?, ?, ?)'
		);
		fonts.forEach((font, position) => insert.run(position, font.family, font.style, font.source));
	}

	private loadUnchecked(): DesignDocument {
		const db = this.requireOpen();
		const info = this.info();
		const nodes: Record<string, Node> = {};
		for (const chunk of this.pages()) {
			for (const node of chunk.nodes) nodes[node.id] = node;
		}
		const stored = db.prepare('SELECT count(*) AS count FROM nodes').get();
		const storedCount = stored === undefined ? 0 : Number(stored.count);
		if (storedCount !== Object.keys(nodes).length) {
			throw new StoreError(
				'CORRUPT',
				`${this.path} has ${storedCount - Object.keys(nodes).length} nodes that belong to no page`
			);
		}
		const document: DesignDocument = {
			schemaVersion: info.schemaVersion,
			id: info.documentId,
			name: info.name,
			nodes,
			styles: this.readEntities<Style>('styles'),
			variableCollections: this.readEntities<VariableCollection>('variable_collections'),
			variables: this.readEntities<Variable>('variables'),
			assets: this.readAssets(),
			fonts: this.readFonts()
		};
		const parsed = parseDesignDocument(document);
		if (!parsed.ok) {
			throw new StoreError('CORRUPT', `${this.path} holds an invalid document: ${parsed.message}`);
		}
		return parsed.value;
	}

	private readEntities<T extends { id: string }>(table: string): Record<string, T> {
		const rows = this.requireOpen().prepare(`SELECT id, data FROM ${table} ORDER BY id`).all();
		const entities: Record<string, T> = {};
		for (const row of rows) {
			const jsonRow: JsonEntityRow = { id: textOf(row, 'id'), data: textOf(row, 'data') };
			const entity = jsonRowToEntity<T>(jsonRow);
			entities[entity.id] = entity;
		}
		return entities;
	}

	private readAssets(): Record<string, AssetRecord> {
		const rows = this.requireOpen()
			.prepare('SELECT hash, mime, width, height FROM assets ORDER BY hash')
			.all();
		const assets: Record<string, AssetRecord> = {};
		for (const row of rows) {
			const assetRow: AssetRow = {
				hash: textOf(row, 'hash'),
				mime: textOf(row, 'mime'),
				width: numberOrNull(row, 'width'),
				height: numberOrNull(row, 'height')
			};
			assets[assetRow.hash] = rowToAsset(assetRow);
		}
		return assets;
	}

	private readFonts(): FontReference[] {
		const rows = this.requireOpen()
			.prepare('SELECT family, style, source FROM fonts ORDER BY position')
			.all();
		return rows.map((row) => {
			const source = textOf(row, 'source');
			if (source !== 'system' && source !== 'embedded') {
				throw new StoreError('CORRUPT', `font source "${source}" is unknown`);
			}
			return { family: textOf(row, 'family'), style: textOf(row, 'style'), source };
		});
	}
}
