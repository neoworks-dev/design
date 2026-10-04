import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBlankDocument } from '../../src/lib/document/blank';
import { parseDesignDocument } from '../../src/lib/document/schema';
import { APPLICATION_ID, FILE_EXTENSION, FILE_MIME_TYPE, FILE_UTI } from './constants';
import { DocumentFile } from './documentFile';
import { StoreError } from './errors';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, readUserVersion } from './migrations';
import { richDocument } from './testDocument';

let directory = '';

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ndesign-test-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function filePath(name = 'doc'): string {
	return path.join(directory, `${name}.${FILE_EXTENSION}`);
}

function sha256(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function tamper(file: string, work: (database: DatabaseSync) => void): void {
	const database = new DatabaseSync(file);
	try {
		database.exec('PRAGMA journal_mode = DELETE');
		work(database);
	} finally {
		database.close();
	}
}

function storeErrorCode(work: () => unknown): string {
	try {
		work();
	} catch (error) {
		if (error instanceof StoreError) return error.code;
		throw error;
	}
	return 'no error';
}

describe('file format constants', () => {
	it('lives in one module: .ndesign, MIME, UTI, NWDS application id', () => {
		expect(FILE_EXTENSION).toBe('ndesign');
		expect(FILE_MIME_TYPE).toBe('application/vnd.neoworks.design+sqlite');
		expect(FILE_UTI).toBe('dev.neoworks.design');
		expect(APPLICATION_ID).toBe(0x4e574453);
		expect(Buffer.from(APPLICATION_ID.toString(16), 'hex').toString('ascii')).toBe('NWDS');
	});
});

describe('create, close, reopen', () => {
	it('yields an identical document', () => {
		const document = richDocument();
		const file = DocumentFile.create(filePath(), document);
		expect(file.load()).toEqual(document);
		file.close();

		const reopened = DocumentFile.open(filePath());
		expect(reopened.load()).toEqual(document);
		expect(parseDesignDocument(reopened.load()).ok).toBe(true);
		reopened.close();
	});

	it('creates a blank document with one page when none is given', () => {
		const file = DocumentFile.create(filePath());
		const loaded = file.load();
		expect(Object.values(loaded.nodes).map((node) => node.type)).toEqual(['PAGE']);
		file.close();
	});

	it('stores the format marker, the version and WAL pragmas', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		const database = file.requireOpen();
		expect(database.prepare('PRAGMA application_id').get()).toEqual({
			application_id: APPLICATION_ID
		});
		expect(database.prepare('PRAGMA user_version').get()).toEqual({
			user_version: LATEST_SCHEMA_VERSION
		});
		expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
		expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
		expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
		expect(file.info()).toMatchObject({
			documentId: 'doc-rich',
			name: 'Rich fixture',
			schemaVersion: LATEST_SCHEMA_VERSION
		});
		const tables = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining([
				'assets',
				'fonts',
				'meta',
				'nodes',
				'styles',
				'thumbnails',
				'transactions',
				'variable_collections',
				'variables'
			])
		);
		file.close();
	});

	it('writes one row per node with columns for the tree and JSON for the rest', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		const row = file.requireOpen().prepare("SELECT * FROM nodes WHERE type = 'TEXT'").get();
		expect(row).toMatchObject({
			type: 'TEXT',
			parent_id: expect.any(String),
			idx: expect.any(String)
		});
		const data: unknown = JSON.parse(String(row?.data));
		expect(data).toMatchObject({ name: 'Title' });
		expect(data).not.toHaveProperty('id');
		expect(data).not.toHaveProperty('parentId');
		expect(data).not.toHaveProperty('type');
		file.close();
	});

	it('refuses to overwrite unless asked, and replaces the file when asked', () => {
		DocumentFile.create(filePath(), richDocument()).close();
		expect(storeErrorCode(() => DocumentFile.create(filePath()))).toBe('ALREADY_EXISTS');
		const replaced = DocumentFile.create(filePath(), createBlankDocument('Fresh'), {
			overwrite: true
		});
		expect(replaced.info().name).toBe('Fresh');
		replaced.close();
	});

	it('closing checkpoints the WAL and leaves a single file', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		file.close();
		file.close();
		expect(existsSync(`${filePath()}-wal`)).toBe(false);
		expect(existsSync(`${filePath()}-shm`)).toBe(false);
		expect(storeErrorCode(() => file.load())).toBe('CLOSED');
	});

	it('round trips asset bytes and keeps records without bytes', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		const hash = 'a'.repeat(64);
		expect(file.readAssetBytes(hash)).toBeNull();
		file.writeAssetBytes(hash, new Uint8Array([1, 2, 3]));
		expect([...(file.readAssetBytes(hash) ?? [])]).toEqual([1, 2, 3]);
		expect(storeErrorCode(() => file.writeAssetBytes('missing', new Uint8Array()))).toBe('CORRUPT');
		file.close();
	});
});

describe('loading by page', () => {
	it('streams pages in order, each with its nodes parents first', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		const chunks = [...file.pages()];
		expect(chunks.map((chunk) => chunk.page.name)).toEqual(['Home', 'Components', 'Archive']);
		const home = chunks[0];
		expect(home.nodes[0].id).toBe(home.page.id);
		expect(home.nodes.map((node) => node.name)).toEqual([
			'Home',
			'Hero',
			'Footer',
			'Background',
			'Title',
			'Badges',
			'Badge 1',
			'Badge 2'
		]);
		const seen = new Set<string>();
		for (const node of home.nodes) {
			if (node.parentId !== null) expect(seen.has(node.parentId)).toBe(true);
			seen.add(node.id);
		}
		file.close();
	});
});

describe('refusing files', () => {
	it('opening a newer-version file fails with a clear message and never writes', () => {
		const target = filePath('newer');
		DocumentFile.create(target, richDocument()).close();
		tamper(target, (database) => database.exec('PRAGMA user_version = 99'));
		const before = sha256(target);

		let message = '';
		let code = '';
		try {
			DocumentFile.open(target);
		} catch (error) {
			if (error instanceof StoreError) {
				code = error.code;
				message = error.message;
			}
		}
		expect(code).toBe('NEWER_VERSION');
		expect(message).toMatch(/newer version of the app/);
		expect(message).toMatch(/format 99/);
		expect(sha256(target)).toBe(before);
		expect(existsSync(`${target}-wal`)).toBe(false);
		expect(existsSync(`${target}-shm`)).toBe(false);
	});

	it('a file that is not a design file is refused before a connection exists', () => {
		const text = filePath('text');
		writeFileSync(
			text,
			'hello, this is not sqlite at all, and it is longer than a header'.repeat(5)
		);
		expect(storeErrorCode(() => DocumentFile.open(text))).toBe('NOT_A_DESIGN_FILE');

		const empty = filePath('empty');
		writeFileSync(empty, '');
		expect(storeErrorCode(() => DocumentFile.open(empty))).toBe('NOT_A_DESIGN_FILE');

		const foreign = filePath('foreign');
		const database = new DatabaseSync(foreign);
		database.exec('CREATE TABLE t (a)');
		database.close();
		expect(storeErrorCode(() => DocumentFile.open(foreign))).toBe('NOT_A_DESIGN_FILE');

		expect(storeErrorCode(() => DocumentFile.open(filePath('missing')))).toBe('NOT_FOUND');

		// A header without an application id next to a pending WAL may just be stale; the file
		// is then verified through SQL after opening, and still refused when it is not ours.
		const stale = filePath('stale');
		const staleDatabase = new DatabaseSync(stale);
		staleDatabase.exec('CREATE TABLE t (a)');
		staleDatabase.close();
		writeFileSync(`${stale}-wal`, Buffer.alloc(64));
		expect(storeErrorCode(() => DocumentFile.open(stale))).toBe('NOT_A_DESIGN_FILE');
		expect(readFileSync(text, 'utf8').startsWith('hello')).toBe(true);
	});
});

describe('corrupt files give typed errors, not crashes', () => {
	function validFile(name: string): string {
		const target = filePath(name);
		DocumentFile.create(target, richDocument()).close();
		return target;
	}

	function loadCode(target: string): string {
		return storeErrorCode(() => {
			const file = DocumentFile.open(target);
			try {
				file.load();
			} finally {
				file.close();
			}
		});
	}

	it('damaged pages after the header', () => {
		const target = validFile('damaged');
		const bytes = readFileSync(target);
		for (let offset = 4096; offset < bytes.length; offset += 7) bytes[offset] = 0xff;
		writeFileSync(target, bytes);
		expect(loadCode(target)).toBe('CORRUPT');
	});

	it('a truncated file', () => {
		const target = validFile('truncated');
		const bytes = readFileSync(target);
		writeFileSync(target, bytes.subarray(0, Math.floor(bytes.length / 2)));
		expect(loadCode(target)).toBe('CORRUPT');
	});

	it('unreadable JSON in a node row', () => {
		const target = validFile('json');
		tamper(target, (database) => database.exec("UPDATE nodes SET data = '{' WHERE type = 'TEXT'"));
		expect(loadCode(target)).toBe('CORRUPT');
	});

	it('a node that violates the schema', () => {
		const target = validFile('schema');
		tamper(target, (database) =>
			database.exec(
				`UPDATE nodes SET data = json_set(data, '$.opacity', 'opaque') WHERE type = 'GROUP'`
			)
		);
		expect(loadCode(target)).toBe('CORRUPT');
	});

	it('nodes that belong to no page', () => {
		const target = validFile('orphans');
		tamper(target, (database) =>
			database.exec("UPDATE nodes SET parent_id = 'ghost' WHERE type = 'TEXT'")
		);
		expect(loadCode(target)).toMatch(/CORRUPT/);
	});

	it('a missing meta row', () => {
		const target = validFile('meta');
		tamper(target, (database) => database.exec("DELETE FROM meta WHERE key = 'file_id'"));
		expect(loadCode(target)).toBe('CORRUPT');
	});
});

describe('migrations', () => {
	function bareDatabase(): DatabaseSync {
		return new DatabaseSync(':memory:');
	}

	it('version 1 builds the whole schema and records the version both ways', () => {
		const database = bareDatabase();
		expect(migrate(database)).toEqual([1]);
		expect(readUserVersion(database)).toBe(1);
		expect(database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({
			value: '1'
		});
		expect(database.prepare('PRAGMA application_id').get()).toEqual({
			application_id: APPLICATION_ID
		});
		expect(migrate(database)).toEqual([]);
	});

	it('applies only the steps above the current version, each once, in order', () => {
		const database = bareDatabase();
		migrate(database);
		const ran: number[] = [];
		const steps = [
			...MIGRATIONS,
			{
				version: 2,
				description: 'add a column',
				up: (db: DatabaseSync): void => {
					ran.push(2);
					db.exec('ALTER TABLE nodes ADD COLUMN extra TEXT');
				}
			},
			{
				version: 3,
				description: 'add an index',
				up: (db: DatabaseSync): void => {
					ran.push(3);
					db.exec('CREATE INDEX nodes_by_type ON nodes (type)');
				}
			}
		];
		expect(migrate(database, steps)).toEqual([2, 3]);
		expect(ran).toEqual([2, 3]);
		expect(readUserVersion(database)).toBe(3);
		expect(database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({
			value: '3'
		});
		expect(migrate(database, steps)).toEqual([]);
	});

	it('a failing step rolls back completely and leaves the previous version', () => {
		const database = bareDatabase();
		migrate(database);
		const failing = [
			...MIGRATIONS,
			{
				version: 2,
				description: 'half done',
				up: (db: DatabaseSync): void => {
					db.exec('ALTER TABLE nodes ADD COLUMN extra TEXT');
					throw new Error('boom');
				}
			}
		];
		expect(() => migrate(database, failing)).toThrow('boom');
		expect(readUserVersion(database)).toBe(1);
		const columns = database
			.prepare('PRAGMA table_info(nodes)')
			.all()
			.map((row) => row.name);
		expect(columns).not.toContain('extra');
	});

	it('the migration registry is contiguous and ends at the document SCHEMA_VERSION', async () => {
		expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
			MIGRATIONS.map((_migration, position) => position + 1)
		);
		const { SCHEMA_VERSION } = await import('../../src/lib/document/types');
		expect(LATEST_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
	});
});

describe('golden fixtures, one per schema version', () => {
	const fixtures = path.join(import.meta.dirname, 'fixtures');
	const versions = [1];

	// To (re)create a fixture after a deliberate format change:
	//   UPDATE_GOLDEN=1 bun run test electron/store/documentFile.test.ts
	// Review the diff of the .json file: it is the contract with files already on users' disks.
	if (process.env.UPDATE_GOLDEN === '1') {
		it('regenerates the current version fixture', () => {
			const target = path.join(directory, 'golden.ndesign');
			DocumentFile.create(target, richDocument()).close();
			copyFileSync(target, path.join(fixtures, `v${LATEST_SCHEMA_VERSION}.ndesign`));
			writeFileSync(
				path.join(fixtures, `v${LATEST_SCHEMA_VERSION}.expected.json`),
				`${JSON.stringify(richDocument(), null, '\t')}\n`
			);
		});
	}

	for (const version of versions) {
		it(`opens the v${version} file written by that version and loads the expected document`, () => {
			const copy = filePath(`golden-v${version}`);
			copyFileSync(path.join(fixtures, `v${version}.ndesign`), copy);
			const expected: unknown = JSON.parse(
				readFileSync(path.join(fixtures, `v${version}.expected.json`), 'utf8')
			);
			const file = DocumentFile.open(copy);
			expect(file.load()).toEqual(expected);
			expect(file.info().schemaVersion).toBe(LATEST_SCHEMA_VERSION);
			file.close();
		});
	}
});
